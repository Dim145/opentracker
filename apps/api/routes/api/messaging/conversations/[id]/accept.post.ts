/**
 * POST /api/messaging/conversations/:id/accept
 *
 * Take a first contact out of the requests queue and into the inbox.
 *
 * There is deliberately no matching "decline" that tells the sender
 * anything. A refusal that notifies is an invitation to try again from
 * another account; declining is a local delete plus a block, and from the
 * other side it looks exactly like a message nobody got round to reading.
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
  if (membership.state === 'active') return { ok: true, alreadyActive: true };

  await db
    .update(schema.conversationParticipants)
    .set({ state: 'active' })
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, id),
        eq(schema.conversationParticipants.userId, user.id)
      )
    );

  return { ok: true, alreadyActive: false };
});
