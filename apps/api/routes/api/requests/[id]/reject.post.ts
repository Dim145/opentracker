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
  // Atomicity mirrors validate.post.ts: the request UPDATE carries the
  // `status = 'filled'` predicate so a concurrent validate / auto-validate
  // that already flipped the row to a terminal state results in an empty
  // `returning()`. Without this guard a reject racing a validate would
  // re-open an already-paid request (status back to 'requested',
  // filledById null) while the filler kept the reward — a points-minting
  // path via re-fill or cancel-refund (finding M6).
  const resolved = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.uploadRequests)
      .set({
        status: 'requested',
        filledById: null,
        filledTorrentId: null,
        filledAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.uploadRequests.id, id),
          eq(schema.uploadRequests.status, 'filled'),
        ),
      )
      .returning({ id: schema.uploadRequests.id });
    if (!updated) {
      return false; // raced — another path already resolved this row
    }
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
    return true;
  });

  if (!resolved) {
    throw createError({
      statusCode: 409,
      message: 'This request was already resolved',
    });
  }

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
