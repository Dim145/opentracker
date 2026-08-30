/**
 * POST /api/messaging/conversations/:id/archive
 * DELETE to bring it back.
 *
 * Archiving is per-member: it takes the conversation out of one person's
 * list without touching the other's. That asymmetry is the point — the
 * alternative, where tidying your own inbox removes the thread from
 * somebody else's, is not a filing action, it is a deletion.
 *
 * A new message DOES un-archive, for whoever receives it. The rule used
 * to be the opposite, and the opposite turned archiving into a way of
 * silencing a person rather than filing their thread: the unread count
 * climbed inside a list nobody looks at, and the only way back was to
 * remember they existed. Every mainstream messenger does the same — Gmail,
 * Messenger and Telegram all restore on the next message.
 *
 * While it IS on the shelf it is read-only, which is this instance's own
 * decision rather than a convention: no message, no edit, no withdrawal,
 * no reaction, enforced on the server.
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';
import { participantOf } from '~~/utils/messaging/conversations';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const membership = await participantOf(id, user.id);
  if (!membership || membership.state === 'blocked') {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  const archiving = event.method !== 'DELETE';
  await db
    .update(schema.conversationParticipants)
    .set({ archivedAt: archiving ? new Date() : null })
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, id),
        eq(schema.conversationParticipants.userId, user.id)
      )
    );

  return { ok: true, archived: archiving };
});
