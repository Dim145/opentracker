/**
 * GET /api/messaging/conversations
 *
 * The inbox. Two lists in one response, split by the participant's
 * `state`: `active` is the inbox proper, `pending` is the first-contact
 * queue — a message from somebody you have never exchanged with waits
 * there rather than landing in the inbox.
 *
 * Nothing here aggregates. `lastMessageAt` and `unreadCount` are
 * denormalised columns maintained on write, because counting messages per
 * conversation on every render is what makes an inbox slow long before
 * anything else does.
 */
import { db, schema } from '@trackarr/db';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.public);

  const rows = await db
    .select({
      conversationId: schema.conversations.id,
      encrypted: schema.conversations.encrypted,
      lastMessageAt: schema.conversations.lastMessageAt,
      unreadCount: schema.conversationParticipants.unreadCount,
      state: schema.conversationParticipants.state,
      mutedUntil: schema.conversationParticipants.mutedUntil,
    })
    .from(schema.conversationParticipants)
    .innerJoin(
      schema.conversations,
      eq(schema.conversations.id, schema.conversationParticipants.conversationId)
    )
    .where(
      and(
        eq(schema.conversationParticipants.userId, user.id),
        eq(schema.conversations.kind, 'dm'),
        isNull(schema.conversationParticipants.archivedAt),
        ne(schema.conversationParticipants.state, 'blocked')
      )
    )
    .orderBy(desc(schema.conversations.lastMessageAt))
    .limit(200);

  if (rows.length === 0) return { inbox: [], requests: [] };

  // The other side of each DM, in one query rather than one per row.
  const ids = rows.map((r) => r.conversationId);
  const others = await db
    .select({
      conversationId: schema.conversationParticipants.conversationId,
      userId: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
    })
    .from(schema.conversationParticipants)
    .leftJoin(
      schema.users,
      eq(schema.users.id, schema.conversationParticipants.userId)
    )
    .where(
      and(
        inArray(schema.conversationParticipants.conversationId, ids),
        ne(schema.conversationParticipants.userId, user.id)
      )
    );

  const otherBy = new Map(others.map((o) => [o.conversationId, o]));

  const shaped = rows.map((row) => {
    const other = otherBy.get(row.conversationId);
    return {
      id: row.conversationId,
      encrypted: row.encrypted,
      lastMessageAt: row.lastMessageAt,
      unreadCount: row.unreadCount,
      mutedUntil: row.mutedUntil,
      // A deleted account keeps no name here: `authorId` went null on
      // deletion and the client renders the absence, rather than a
      // remembered username that erasure was supposed to remove.
      with: other?.userId
        ? {
            id: other.userId,
            username: other.username,
            displayName: other.displayName,
          }
        : null,
    };
  });

  return {
    inbox: shaped.filter((_, i) => rows[i]!.state === 'active'),
    requests: shaped.filter((_, i) => rows[i]!.state === 'pending'),
  };
});
