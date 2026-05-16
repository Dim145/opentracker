/**
 * POST /api/requests/:id/validate
 *
 * Requester accepts the current fill. Reward (if any) is paid to
 * the filler in the same transaction as the status flip — no
 * window where the points can vanish or get double-paid.
 *
 * Only the requester can call this. The cron uses the shared
 * `validateRequest` helper for auto-validation; the two paths are
 * deliberately kept separate at the HTTP layer so the audit trail
 * tells you which one ran.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { notify } from '~~/utils/notify';
import { payReward } from '~~/utils/requestPoints';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));

  const request = await db.query.uploadRequests.findFirst({
    where: eq(schema.uploadRequests.id, id),
  });
  if (!request) {
    throw createError({ statusCode: 404, message: 'Request not found' });
  }
  if (request.requesterId !== user.id) {
    throw createError({
      statusCode: 403,
      message: 'Only the requester can validate a fill',
    });
  }
  if (request.status !== 'filled') {
    throw createError({
      statusCode: 400,
      message: 'No active fill to validate',
    });
  }
  if (!request.filledById) {
    // Defensive: status=filled with no filler is corruption.
    throw createError({ statusCode: 500, message: 'Filler missing' });
  }

  const fillerId = request.filledById;
  const reward = request.rewardPoints;
  const now = new Date();
  await db.transaction(async (tx) => {
    if (reward > 0) {
      await payReward(tx, fillerId, reward);
    }
    await tx
      .update(schema.uploadRequests)
      .set({
        status: 'validated',
        validatedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.uploadRequests.id, id));
    await tx
      .update(schema.uploadRequestFillAttempts)
      .set({ status: 'validated' })
      .where(
        and(
          eq(schema.uploadRequestFillAttempts.requestId, id),
          eq(schema.uploadRequestFillAttempts.userId, fillerId),
          eq(schema.uploadRequestFillAttempts.status, 'proposed'),
        ),
      );
  });

  void notify(
    fillerId,
    'request_validated',
    {
      requestId: id,
      requestTitle: request.title,
      rewardPoints: reward,
      requesterUsername: user.username,
    },
    `/requests/${id}`,
  );

  return { success: true };
});
