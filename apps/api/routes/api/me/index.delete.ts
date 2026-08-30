/**
 * DELETE /api/me  { confirm: "<my-username>" }
 *
 * Self-service account erasure — the GDPR right to erasure, exercised by the
 * account itself. Anonymises the row and retracts the federated identity; see
 * `utils/account/eraseAccount` for exactly what survives and what does not.
 *
 * Three guards, because this is a one-way door:
 *   - a live, non-banned session (the standard auth gate),
 *   - a *fresh* login (step-up): a borrowed but stale session cannot erase the
 *     victim's account without re-authenticating first,
 *   - the account's own username, typed back — friction a person clears in a
 *     second and a forged cross-site request cannot supply.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { validateBody } from '~~/utils/schemas';
import { requireAuthSession, requireFreshAuth } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { eraseAccount } from '~~/utils/account/eraseAccount';

const bodySchema = z.object({ confirm: z.string() });

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  await requireFreshAuth(event);

  const { confirm } = await validateBody(event, bodySchema);

  // The current username from the row, not the session — the session can be
  // stale, and the whole point is to match what the account is right now.
  const [row] = await db
    .select({ username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);
  if (!row) throw createError({ statusCode: 404, message: 'Account not found' });
  if (confirm !== row.username) {
    throw createError({
      statusCode: 400,
      message: 'Confirmation does not match your username',
    });
  }

  const result = await eraseAccount(user.id);

  // Clear the cookie on the way out. The auth gate already refuses the account
  // from here on, but leaving a dead cookie in place is untidy.
  await clearUserSession(event);

  return { ok: true, ...result };
});
