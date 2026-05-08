/**
 * POST /api/auth/passkey
 *
 * Rotate the current user's passkey. Generates a new 32-char hex token,
 * persists it to the users row, and refreshes the cookie session so
 * subsequent calls (e.g. /api/auth/passkey GET) return the new value
 * without forcing a re-login.
 *
 * Side-effects: any torrent client configured with the old announce URL
 * stops working — the user has to update their client. The endpoint
 * deliberately requires a confirmation token in the request body so an
 * accidental form submit can't burn the user's announce setup.
 *
 * Auth: any logged-in user. Rate-limited via the standard mutation
 * bucket so a hijacked session can't churn passkeys to lock out the
 * legitimate owner.
 *
 * The new passkey collides with an existing one with probability
 * 1/2^160; the unique-index on the column will reject the update if it
 * does happen, and we surface that as a 500 — the user can retry.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { generateToken } from '~~/utils/server';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { z } from 'zod';

const bodySchema = z.object({
  confirm: z.literal(true, {
    // The frontend sends `{ confirm: true }` after the user accepts the
    // confirmation dialog. We reject anything else so a CSRF attempt
    // with an empty body can't silently rotate the key.
    errorMap: () => ({ message: 'Passkey rotation must be confirmed' }),
  }),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  await readValidatedBody(event, bodySchema.parse);

  // generateToken(16) returns 32 hex chars — same length the register
  // route uses, which matches the schema's `text` column expectations
  // and what BitTorrent clients pass through ?passkey=.
  const fresh = generateToken(16);

  const [updated] = await db
    .update(schema.users)
    .set({ passkey: fresh })
    .where(eq(schema.users.id, user.id))
    .returning({ passkey: schema.users.passkey });

  if (!updated) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    });
  }

  // Refresh the session in place so the next reveal/copy on the page
  // returns the new value rather than the stale one we cached at login.
  await setUserSession(event, {
    user: {
      ...user,
      passkey: updated.passkey,
    },
    loggedInAt: Date.now(),
  });

  return { passkey: updated.passkey };
});
