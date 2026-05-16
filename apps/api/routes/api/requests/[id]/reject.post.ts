/**
 * POST /api/requests/:id/reject
 *
 * Requester rejects the current fill. The request flips back to
 * `requested` (and is open to new proposals — possibly from the
 * same uploader if they haven't blown the per-user cap yet). The
 * existing `proposed` attempt row is stamped `rejected` so the
 * counter for that user reflects the bounce.
 *
 * Reward is not touched: it stays held by the requester. Only
 * cancel or validate move the money.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { notify } from '~~/utils/notify';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  reason: z.string().max(500).optional(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));
  // Body is optional — the FE button fires reject without one.
  // Read raw, default to {}, then validate against the schema.
  const rawBody = (await readBody(event).catch(() => null)) ?? {};
  const body = bodySchema.parse(rawBody);

  const request = await db.query.uploadRequests.findFirst({
    where: eq(schema.uploadRequests.id, id),
  });
  if (!request) {
    throw createError({ statusCode: 404, message: 'Request not found' });
  }
  if (request.requesterId !== user.id) {
    throw createError({
      statusCode: 403,
      message: 'Only the requester can reject a fill',
    });
  }
  if (request.status !== 'filled') {
    throw createError({
      statusCode: 400,
      message: 'No active fill to reject',
    });
  }
  if (!request.filledById) {
    throw createError({ statusCode: 500, message: 'Filler missing' });
  }

  const fillerId = request.filledById;
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.uploadRequestFillAttempts)
      .set({ status: 'rejected', rejectedAt: now })
      .where(
        and(
          eq(schema.uploadRequestFillAttempts.requestId, id),
          eq(schema.uploadRequestFillAttempts.userId, fillerId),
          eq(schema.uploadRequestFillAttempts.status, 'proposed'),
        ),
      );
    await tx
      .update(schema.uploadRequests)
      .set({
        status: 'requested',
        filledById: null,
        filledTorrentId: null,
        filledAt: null,
        updatedAt: now,
      })
      .where(eq(schema.uploadRequests.id, id));
  });

  void notify(
    fillerId,
    'request_rejected',
    {
      requestId: id,
      requestTitle: request.title,
      requesterUsername: user.username,
      reason: body.reason ?? null,
    },
    `/requests/${id}`,
  );

  return { success: true };
});
