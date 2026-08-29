/**
 * POST /api/messaging/conversations/:id/mute
 *
 * Stop being notified about one conversation, for a while. Body `{ hours }`,
 * or `{ hours: 0 }` to lift it.
 *
 * Timed rather than permanent, because a permanent mute is how a
 * conversation goes unanswered for a month without anybody deciding to
 * ignore it. The unread counter still moves — muting is about
 * notifications, not about pretending nothing arrived.
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireDmAccess } from '~~/utils/messaging/guard';
import { participantOf } from '~~/utils/messaging/conversations';

const bodySchema = z.object({ hours: z.number().min(0).max(24 * 365) }).strict();

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

  const body = await validateBody(event, bodySchema);
  const mutedUntil =
    body.hours > 0 ? new Date(Date.now() + body.hours * 3600 * 1000) : null;

  await db
    .update(schema.conversationParticipants)
    .set({ mutedUntil })
    .where(
      and(
        eq(schema.conversationParticipants.conversationId, id),
        eq(schema.conversationParticipants.userId, user.id)
      )
    );

  return { ok: true, mutedUntil };
});
