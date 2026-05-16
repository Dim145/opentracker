/**
 * POST /api/requests
 *
 * Create a new bounty. The reward (if any) is held from the
 * requester's bonus_points immediately so the surface shows
 * accurate "available" balance everywhere else.
 *
 * Validation:
 *   - category must exist
 *   - reward >= 0
 *   - requester must have enough bonus_points to cover the reward
 *
 * Returns the created row.
 */
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { holdReward, RewardError } from '~~/utils/requestPoints';

const bodySchema = z.object({
  // The categories table stores its id as `text`, not `uuid` —
  // some legacy seeds carry slug-like ids. The existence check
  // immediately below the parse is the authoritative gate.
  categoryId: z.string().min(1).max(128),
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(4000),
  rewardPoints: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await readValidatedBody(event, bodySchema.parse);

  // Reject early if the category vanished between the form load and
  // the submit — surfacing the error here is friendlier than letting
  // the FK fail at insert time.
  const category = await db.query.categories.findFirst({
    where: eq(schema.categories.id, body.categoryId),
    columns: { id: true },
  });
  if (!category) {
    throw createError({ statusCode: 400, message: 'Category not found' });
  }

  const id = randomUUID();
  try {
    await db.transaction(async (tx) => {
      // Hold the reward before inserting so a balance check failure
      // doesn't leave an orphaned request row.
      if (body.rewardPoints > 0) {
        await holdReward(tx, user.id, body.rewardPoints);
      }
      await tx.insert(schema.uploadRequests).values({
        id,
        requesterId: user.id,
        categoryId: body.categoryId,
        title: body.title,
        description: body.description,
        rewardPoints: body.rewardPoints,
        status: 'requested',
      });
    });
  } catch (err) {
    if (err instanceof RewardError) {
      throw createError({ statusCode: err.statusCode, message: err.message });
    }
    throw err;
  }

  return { id };
});
