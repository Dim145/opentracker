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
import { and, desc, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.public);

  // Archived conversations are a separate view rather than a flag on the
  // same list: filing something away is meant to remove it from sight,
  // and a list that still carries it with a marker has not done that.
  const archived = getQuery(event).archived === 'true';

  const rows = await db
    .select({
      conversationId: schema.conversations.id,
      encrypted: schema.conversations.encrypted,
      lastMessageAt: schema.conversations.lastMessageAt,
      unreadCount: schema.conversationParticipants.unreadCount,
      state: schema.conversationParticipants.state,
      mutedUntil: schema.conversationParticipants.mutedUntil,
      lastReadAt: schema.conversationParticipants.lastReadAt,
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
        archived
          ? isNotNull(schema.conversationParticipants.archivedAt)
          : isNull(schema.conversationParticipants.archivedAt),
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
      and(
        eq(schema.users.id, schema.conversationParticipants.userId),
        // An erased account is anonymised in place, not deleted, so the
        // row is still here and still joins. Failing the join is what
        // turns it back into the absence the client renders.
        isNull(schema.users.deletedAt)
      )
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
      lastReadAt: row.lastReadAt,
      // A deleted account keeps no name here: the join above refuses
      // erased rows, so the client renders the absence rather than the
      // `deleted-<random>` placeholder erasure left behind.
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
