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
import { and, eq } from 'drizzle-orm';
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

  // Atomicity: the row UPDATE carries the `status = 'requested'`
  // predicate, so two concurrent cancel calls don't both pass the
  // status check and double-refund. The losing transaction
  // returns an empty `returning()` and bails before crediting.
  const refunded = await db.transaction(async (tx) => {
    const now = new Date();
    const [updated] = await tx
      .update(schema.uploadRequests)
      .set({
        status: 'cancelled',
        cancelledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.uploadRequests.id, id),
          eq(schema.uploadRequests.status, 'requested'),
        ),
      )
      .returning({ id: schema.uploadRequests.id });
    if (!updated) {
      return false; // raced — another path closed this row
    }
    if (row.rewardPoints > 0) {
      await refundReward(tx, user.id, row.rewardPoints);
    }
    // Defense-in-depth: cancel a `requested` row with no active
    // fill, but the fill race could in theory have left orphan
    // `proposed` attempts. Stamp any lingering ones as rejected
    // so the per-user attempt counter isn't permanently inflated
    // by a row that never reached the requester for review.
    await tx
      .update(schema.uploadRequestFillAttempts)
      .set({ status: 'rejected', rejectedAt: now })
      .where(
        and(
          eq(schema.uploadRequestFillAttempts.requestId, id),
          eq(schema.uploadRequestFillAttempts.status, 'proposed'),
        ),
      );
    return true;
  });

  if (!refunded) {
    throw createError({
      statusCode: 409,
      message: 'This request can no longer be cancelled',
    });
  }

  return { success: true };
});
