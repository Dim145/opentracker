/**
 * POST /api/freeleech-pool/contribute — apply a contribution.
 *
 * Body: { amount: number }
 *
 * Atomicity sits inside `contribute()` — every check + mutation
 * lives in the same transaction with an advisory lock so the cron
 * and concurrent contributors can't race.
 *
 * Rate-limited via the standard mutation bucket so a hijacked
 * session can't drain a user's balance with a tight loop.
 *
 * When the contribution fills the pool, the response carries
 * `triggered: true` and the cycle row reflects the new `active` or
 * `full_queued` state. The shop widget swaps to a "freeleech
 * active" / "queued behind X" view based on that.
 */
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { contribute, FreeleechPoolError } from '~~/utils/freeleechPool';
import { syncActiveSnapshot } from '~~/utils/bonusEvents';

const bodySchema = z
  .object({
    amount: z.number().int().positive(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await readValidatedBody(event, bodySchema.parse);

  try {
    const result = await contribute(user.id, body.amount);
    // Resync the bonus-events snapshot after a state change. Inside
    // the transaction we couldn't because Redis writes don't roll
    // back; this resync runs only on commit so a rollback can't
    // poison the snapshot.
    if (result.triggered) {
      await syncActiveSnapshot();
    }
    return {
      success: true,
      amountAccepted: result.amountAccepted,
      bonusPoints: result.bonusPointsAfter,
      cycle: result.cycle,
      triggered: result.triggered,
    };
  } catch (err) {
    if (err instanceof FreeleechPoolError) {
      throw createError({ statusCode: err.statusCode, message: err.message });
    }
    throw err;
  }
});
