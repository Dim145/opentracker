/**
 * GET /api/messaging/unread
 *
 * The number the header badge shows: how many unread messages are
 * waiting, and in how many conversations.
 *
 * A sum over the member's own participant rows — the counter is
 * denormalised precisely so this stays one indexed read rather than an
 * aggregate over `messages`, which is the query that falls over first.
 *
 * Archived and blocked rows are excluded: a badge that counts threads the
 * member has already put away is a badge they learn to ignore. Muted ones
 * still count — muting silences the interruption, not the fact.
 *
 * 404 when messaging is off, like the rest of the surface, so the chrome
 * can hide the icon rather than render a permanent zero.
 */
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.public);

  const [row] = await db
    .select({
      messages: sql<number>`coalesce(sum(${schema.conversationParticipants.unreadCount}), 0)::int`,
      conversations: sql<number>`count(*) filter (where ${schema.conversationParticipants.unreadCount} > 0)::int`,
      requests: sql<number>`count(*) filter (where ${schema.conversationParticipants.state} = 'pending')::int`,
    })
    .from(schema.conversationParticipants)
    .where(
      and(
        eq(schema.conversationParticipants.userId, user.id),
        ne(schema.conversationParticipants.state, 'blocked'),
        isNull(schema.conversationParticipants.archivedAt)
      )
    );

  return {
    messages: row?.messages ?? 0,
    conversations: row?.conversations ?? 0,
    requests: row?.requests ?? 0,
  };
});
