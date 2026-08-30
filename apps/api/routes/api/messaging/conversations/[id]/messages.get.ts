/**
 * GET /api/messaging/conversations/:id/messages
 *
 * The thread, newest first, paginated by cursor rather than by offset.
 *
 * Offsets are wrong for a live thread: a message arriving between two
 * page requests shifts every later row by one, so the reader sees a
 * duplicate or a gap. The cursor is the `createdAt` of the oldest row
 * already held, which is stable whatever arrives after it.
 */
import { db, schema } from '@trackarr/db';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { directReactionsFor } from '~~/utils/messaging/reactions';
import { topBadgesFor } from '~~/utils/roleBadge';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateQuery } from '~~/utils/schemas';
import { requireDmAccess } from '~~/utils/messaging/guard';
import { participantOf } from '~~/utils/messaging/conversations';

const querySchema = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.public);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  // Membership is the authorisation. Not being in the conversation is
  // answered with 404 rather than 403, so probing ids tells you nothing
  // about which ones exist.
  const membership = await participantOf(id, user.id);
  if (!membership || membership.state === 'blocked') {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  const query = validateQuery(event, querySchema);

  const rows = await db
    .select({
      id: schema.messages.id,
      authorId: schema.messages.authorId,
      body: schema.messages.body,
      cipher: schema.messages.cipher,
      iv: schema.messages.iv,
      isSystem: schema.messages.isSystem,
      createdAt: schema.messages.createdAt,
      editedAt: schema.messages.editedAt,
      replyToId: schema.messages.replyToId,
      deletedAt: schema.messages.deletedAt,
      authorName: schema.users.username,
      authorDisplayName: schema.users.displayName,
    })
    .from(schema.messages)
    .leftJoin(
      schema.users,
      // Erased authors fail the join on purpose — see the shaping below.
      and(eq(schema.users.id, schema.messages.authorId), isNull(schema.users.deletedAt))
    )
    .where(
      and(
        eq(schema.messages.conversationId, id),
        query.before ? lt(schema.messages.createdAt, query.before) : undefined
      )
    )
    .orderBy(desc(schema.messages.createdAt))
    .limit(query.limit);

  // One extra round trip for the whole page, not one per message. The
  // quoted messages are fetched by id from the same conversation, so a
  // reply can never surface something the reader is not entitled to see.
  const ids = rows.map((r) => r.id);
  const reactions = await directReactionsFor(ids, user.id);
  const badges = await topBadgesFor(
    rows.map((r) => r.authorId).filter(Boolean) as string[]
  );

  const quotedIds = [...new Set(rows.map((r) => r.replyToId).filter(Boolean))] as string[];
  const quoted = quotedIds.length
    ? await db
        .select({
          id: schema.messages.id,
          body: schema.messages.body,
          deletedAt: schema.messages.deletedAt,
          authorName: schema.users.username,
        })
        .from(schema.messages)
        .leftJoin(
          schema.users,
          and(
            eq(schema.users.id, schema.messages.authorId),
            isNull(schema.users.deletedAt)
          )
        )
        .where(
          and(
            inArray(schema.messages.id, quotedIds),
            eq(schema.messages.conversationId, id)
          )
        )
    : [];
  const quotedById = new Map(quoted.map((q) => [q.id, q]));

  return {
    messages: rows.map((row) => ({
      id: row.id,
      // A removed message keeps its row — the thread stays coherent and
      // the audit trail survives — but carries no payload.
      body: row.deletedAt ? null : row.body,
      cipher: row.deletedAt ? null : row.cipher?.toString('base64url') ?? null,
      iv: row.deletedAt ? null : row.iv?.toString('base64url') ?? null,
      isSystem: row.isSystem,
      deleted: !!row.deletedAt,
      createdAt: row.createdAt,
      editedAt: row.editedAt,
      reactions: reactions[row.id]?.counts ?? {},
      myReactions: reactions[row.id]?.mine ?? [],
      // The quote carries a preview, not the message: a reply that
      // embedded the full text would let a deleted message survive inside
      // every answer to it.
      replyTo: row.replyToId
        ? (() => {
            const q = quotedById.get(row.replyToId!);
            if (!q) return { id: row.replyToId, gone: true };
            return {
              id: q.id,
              gone: !!q.deletedAt,
              author: q.authorName,
              preview: q.deletedAt ? null : (q.body?.slice(0, 140) ?? null),
            };
          })()
        : null,
      // Keyed on the joined name, not on `authorId`: erasure keeps the
      // foreign key and blanks the row, so the id outlives the account.
      author: row.authorName
        ? {
            badge: (row.authorId && badges[row.authorId]) || null,
            id: row.authorId,
            username: row.authorName,
            displayName: row.authorDisplayName,
          }
        : null,
    })),
    // Null when the page came back short: there is nothing older.
    nextBefore:
      rows.length === query.limit ? rows[rows.length - 1]!.createdAt : null,
  };
});
