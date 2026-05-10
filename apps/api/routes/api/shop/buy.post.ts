/**
 * POST /api/shop/buy — purchase a shop item.
 *
 * Body: { itemId: string }
 *
 * Returns the post-purchase balance and a structured description of
 * what was applied (so the FE can show a confirmation toast).
 *
 * Atomicity: every check + mutation lives inside a single Postgres
 * transaction in `purchaseItem`, with `FOR UPDATE` row locks on both
 * the item and the user. Rate-limited via the standard mutation bucket
 * so a hijacked session can't churn the ledger.
 */
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { purchaseItem, ShopError } from '~~/utils/shop';

const bodySchema = z.object({ itemId: z.string().min(1) }).strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await readValidatedBody(event, bodySchema.parse);

  try {
    const result = await purchaseItem(user.id, body.itemId);
    return {
      success: true,
      bonusPoints: result.bonusPointsAfter,
      effect: result.appliedEffect,
    };
  } catch (err) {
    if (err instanceof ShopError) {
      throw createError({ statusCode: err.statusCode, message: err.message });
    }
    throw err;
  }
});
