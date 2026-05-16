/**
 * DELETE /api/requests/:id
 *
 * Cancel a request. The held reward (if any) is refunded to the
 * requester's bonus_points in the same transaction as the status
 * flip, so a crash mid-cancel either rolls back both or commits
 * both — the requester can never lose points to a half-cancelled
 * row.
 *
 * Per the design spec, cancel is only allowed while `status =
 * requested`. If a torrent has been proposed (`status = filled`),
 * the requester must reject first to free the slot, then cancel.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { refundReward } from '~~/utils/requestPoints';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));

  const row = await db.query.uploadRequests.findFirst({
    where: eq(schema.uploadRequests.id, id),
  });
  if (!row) {
    throw createError({ statusCode: 404, message: 'Request not found' });
  }
  if (row.requesterId !== user.id) {
    throw createError({
      statusCode: 403,
      message: 'You can only cancel your own requests',
    });
  }
  if (row.status !== 'requested') {
    throw createError({
      statusCode: 400,
      message:
        'A filled request must be rejected before it can be cancelled',
    });
  }

  await db.transaction(async (tx) => {
    if (row.rewardPoints > 0) {
      await refundReward(tx, user.id, row.rewardPoints);
    }
    await tx
      .update(schema.uploadRequests)
      .set({
        status: 'cancelled',
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.uploadRequests.id, id));
  });

  return { success: true };
});
