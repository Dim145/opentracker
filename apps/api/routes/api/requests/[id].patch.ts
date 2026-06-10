/**
 * PATCH /api/requests/:id
 *
 * Owner-only edit of a request that's still in the `requested`
 * state. The reward field is bump-only — dropping it after fillers
 * have started watching would erode trust in the bounty board.
 *
 * Title / description / category are fully editable while the row
 * is in `requested`.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { holdReward, RewardError } from '~~/utils/requestPoints';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    categoryId: z.string().min(1).max(128).optional(),
    title: z.string().min(3).max(200).optional(),
    description: z.string().min(10).max(4000).optional(),
    rewardPoints: z.coerce.number().int().min(0).max(1_000_000).optional(),
  })
  .refine(
    (b) =>
      b.categoryId !== undefined ||
      b.title !== undefined ||
      b.description !== undefined ||
      b.rewardPoints !== undefined,
    { message: 'At least one field must be provided' },
  );

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));
  const body = await readValidatedBody(event, bodySchema.parse);

  const row = await db.query.uploadRequests.findFirst({
    where: eq(schema.uploadRequests.id, id),
  });
  if (!row) {
    throw createError({ statusCode: 404, message: 'Request not found' });
  }
  if (row.requesterId !== user.id) {
    throw createError({
      statusCode: 403,
      message: 'You can only edit your own requests',
    });
  }
  if (row.status !== 'requested') {
    throw createError({
      statusCode: 400,
      message: 'This request can no longer be edited',
    });
  }

  // Reward changes need explicit handling: bump-only, with the
  // delta debited from the requester. Drops are rejected so the
  // bounty board never advertises a higher prize than is actually
  // held.
  let rewardDelta = 0;
  if (body.rewardPoints !== undefined) {
    if (body.rewardPoints < row.rewardPoints) {
      throw createError({
        statusCode: 400,
        message: 'Reward can only be increased, not decreased',
      });
    }
    rewardDelta = body.rewardPoints - row.rewardPoints;
  }

  if (body.categoryId !== undefined && body.categoryId !== row.categoryId) {
    const category = await db.query.categories.findFirst({
      where: eq(schema.categories.id, body.categoryId),
      columns: { id: true },
    });
    if (!category) {
      throw createError({ statusCode: 400, message: 'Category not found' });
    }
  }

  try {
    await db.transaction(async (tx) => {
      if (rewardDelta > 0) {
        await holdReward(tx, user.id, rewardDelta);
      }
      // The write is compare-and-swap, not a blind absolute set. The
      // `status = 'requested'` predicate stops an edit landing on a row
      // a concurrent fill already moved on. When the reward is being
      // changed we ALSO pin the CAS to the exact base we computed the
      // delta against: two concurrent bumps both read base=100, each
      // escrows only its own delta, but a last-writer-wins absolute set
      // would advertise the larger target while only the smaller delta
      // was held — minting the difference on validate/cancel-refund
      // (finding M8). The predicate makes the losing writer miss, roll
      // back its holdReward, and surface a 409.
      const predicates = [
        eq(schema.uploadRequests.id, id),
        eq(schema.uploadRequests.status, 'requested'),
      ];
      if (body.rewardPoints !== undefined) {
        predicates.push(
          eq(schema.uploadRequests.rewardPoints, row.rewardPoints),
        );
      }
      const [updated] = await tx
        .update(schema.uploadRequests)
        .set({
          categoryId: body.categoryId ?? row.categoryId,
          title: body.title ?? row.title,
          description: body.description ?? row.description,
          rewardPoints: body.rewardPoints ?? row.rewardPoints,
          updatedAt: new Date(),
        })
        .where(and(...predicates))
        .returning({ id: schema.uploadRequests.id });
      if (!updated) {
        // Raced with another edit / fill / cancel, or the reward base
        // moved under us. Throwing inside the tx rolls back holdReward.
        throw new RewardError(
          409,
          'This request changed while you were editing it — reload and retry',
        );
      }
    });
  } catch (err) {
    if (err instanceof RewardError) {
      throw createError({ statusCode: err.statusCode, message: err.message });
    }
    throw err;
  }

  return { success: true };
});
