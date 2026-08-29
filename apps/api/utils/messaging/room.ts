import { db, schema } from '@trackarr/db';
import { and, desc, eq, gt, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  getMessagingRoomScope,
  getRoomSlowModeSeconds,
  scopeAdmits,
} from '~~/utils/settings';
import { redis } from '~~/utils/server';

/**
 * The public room.
 *
 * It has no participants. A shoutbox is ambient — nobody joins it, nobody
 * carries an unread count for it — so giving every member a row would be
 * the wrong shape for a table that would then hold three hundred and
 * fifty thousand of them.
 *
 * Its messages live in `room_messages`, partitioned by day, because at
 * three messages a second that is a quarter of a million rows a day and
 * retention has to be a `DROP` of whole partitions rather than a `DELETE`
 * over millions.
 */

export const ROOM_SLUG = 'general';

export async function requireRoomAccess(user: {
  isAdmin?: boolean;
  isModerator?: boolean;
}) {
  const scope = await getMessagingRoomScope();
  // 404, like the rest of the surface: a 403 would confirm the room
  // exists on an instance that decided it does not.
  if (!scopeAdmits(scope, user)) {
    throw createError({ statusCode: 404, message: 'Not found' });
  }
  return scope;
}

/**
 * The room's conversation row, created on first use.
 *
 * An advisory lock rather than a unique-index race: two members arriving
 * at an empty room in the same instant is unlikely and entirely possible,
 * and the failure would be an exception on a page load rather than
 * anything the reader could act on.
 */
export async function ensureRoom() {
  const existing = await db.query.conversations.findFirst({
    where: and(
      eq(schema.conversations.kind, 'room'),
      eq(schema.conversations.slug, ROOM_SLUG)
    ),
  });
  if (existing) return existing;

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('room:general'))`);
    const raced = await tx.query.conversations.findFirst({
      where: and(
        eq(schema.conversations.kind, 'room'),
        eq(schema.conversations.slug, ROOM_SLUG)
      ),
    });
    if (raced) return raced;

    const [created] = await tx
      .insert(schema.conversations)
      .values({
        id: randomUUID(),
        kind: 'room',
        slug: ROOM_SLUG,
        createdAt: new Date(),
        lastMessageAt: new Date(),
      })
      .returning();
    return created!;
  });
}

/** Whether this member is currently silenced, and until when. */
export async function activeMute(userId: string) {
  const row = await db.query.roomMutes.findFirst({
    where: and(
      eq(schema.roomMutes.userId, userId),
      gt(schema.roomMutes.until, new Date())
    ),
  });
  return row ?? null;
}

/**
 * Slow mode, counted in Valkey rather than Postgres.
 *
 * It is a per-member timer read on every send during exactly the moments
 * the room is busiest — which is when a write to Postgres for the purpose
 * of rate-limiting is the least welcome thing to add. A key with a TTL
 * says the same thing and expires itself.
 *
 * Staff are exempt: slow mode exists to damp a flood, and the people
 * expected to talk it down should not be damped by it.
 */
export async function slowModeBlock(user: {
  id: string;
  isAdmin?: boolean;
  isModerator?: boolean;
}) {
  if (user.isAdmin || user.isModerator) return 0;
  const seconds = await getRoomSlowModeSeconds();
  if (seconds <= 0) return 0;

  const key = `messaging:slow:${user.id}`;
  const ok = await redis.set(key, '1', 'EX', seconds, 'NX');
  if (ok) return 0;
  const ttl = await redis.ttl(key);
  return ttl > 0 ? ttl : 0;
}

export async function roomPage(opts: { before?: Date; limit: number }) {
  const room = await ensureRoom();
  const rows = await db
    .select({
      id: schema.roomMessages.id,
      body: schema.roomMessages.body,
      isSystem: schema.roomMessages.isSystem,
      createdAt: schema.roomMessages.createdAt,
      deletedAt: schema.roomMessages.deletedAt,
      authorId: schema.roomMessages.authorId,
      authorName: schema.users.username,
      authorDisplayName: schema.users.displayName,
    })
    .from(schema.roomMessages)
    .leftJoin(schema.users, eq(schema.users.id, schema.roomMessages.authorId))
    .where(
      and(
        eq(schema.roomMessages.conversationId, room.id),
        opts.before ? lt(schema.roomMessages.createdAt, opts.before) : undefined
      )
    )
    .orderBy(desc(schema.roomMessages.createdAt))
    .limit(opts.limit);

  return {
    roomId: room.id,
    messages: rows.map((row) => ({
      id: row.id,
      // A removed message keeps its row so the log stays honest; it just
      // carries nothing.
      body: row.deletedAt ? null : row.body,
      deleted: !!row.deletedAt,
      isSystem: row.isSystem,
      createdAt: row.createdAt,
      author: row.authorId
        ? {
            id: row.authorId,
            username: row.authorName,
            displayName: row.authorDisplayName,
          }
        : null,
    })),
    nextBefore:
      rows.length === opts.limit ? rows[rows.length - 1]!.createdAt : null,
  };
}
