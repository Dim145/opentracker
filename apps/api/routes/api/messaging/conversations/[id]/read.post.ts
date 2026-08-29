/**
 * POST /api/messaging/conversations/:id/read
 *
 * Mark the conversation read up to now.
 *
 * The client calls this at most once every few seconds and on blur, never
 * once per message seen. At ten thousand people online that difference is
 * the whole write budget of the feature — a per-message write would make
 * reading more expensive than sending.
 *
 * Idempotent: marking an already-read conversation costs one UPDATE that
 * changes nothing.
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';
import { participantOf } from '~~/utils/messaging/conversations';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.public);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const membership = await participantOf(id, user.id);
  if (!membership || membership.state === 'blocked') {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  await db
    .update(schema.conversationParticipants)
    .set({ lastReadAt: new Date(), unreadCount: 0 })
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, id),
        eq(schema.conversationParticipants.userId, user.id)
      )
    );

  return { ok: true };
});
