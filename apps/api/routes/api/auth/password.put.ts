/**
 * PUT /api/auth/password
 *
 * Change the logged-in user's password without ever sending it to the
 * server. The flow mirrors login:
 *
 *   1. Client requests a challenge via /api/auth/challenge?username=…
 *      (returns the user's current authSalt + a server-stored challenge
 *       keyed under userId).
 *   2. Client computes `currentProof = SHA256(authVerifier + challenge)`
 *      using the salt from step 1 and the user's CURRENT password.
 *   3. Client also computes a new `{salt, verifier}` pair from the
 *      NEW password (registration-style derivation).
 *   4. Submits `{ challenge, currentProof, newSalt, newVerifier }`.
 *      Server validates the proof against the stored verifier (same as
 *      login), then atomically updates auth_salt + auth_verifier.
 *
 * Side-effects: existing sessions REMAIN valid. The session cookie is
 * sealed with the auth payload set at login time and isn't tied to the
 * password verifier. If the user wants to invalidate other devices,
 * they can sign out (the dropdown action) — we deliberately don't
 * cascade-invalidate here because that would also kill the current tab,
 * forcing an immediate re-login mid-flow.
 *
 * Auth: any logged-in user. Rate-limited via the standard mutation
 * bucket; the proof verification is constant-time so a wrong-password
 * spammer can't time-leak the verifier.
 */
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db, schema } from '@trackarr/db';
import { redis } from '~~/utils/server';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { z } from 'zod';
import { notify } from '~~/utils/notify';

const bodySchema = z.object({
  challenge: z.string().length(64, 'Invalid challenge'),
  currentProof: z.string().length(64, 'Invalid current-password proof'),
  newSalt: z.string().min(40, 'Invalid new salt'),
  newVerifier: z.string().min(40, 'Invalid new verifier'),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  // Password change is a credential operation — use the strict auth
  // bucket (5/5min, progressive) instead of the looser mutation bucket.
  await rateLimit(event, RATE_LIMITS.auth);
  const body = await readValidatedBody(event, bodySchema.parse);

  // Verify the challenge belongs to this user (prevents a hijacker who
  // swapped a session cookie from reusing someone else's challenge).
  const challengedUserId = await redis.get(`login:${body.challenge}`);
  if (!challengedUserId || challengedUserId !== user.id) {
    throw createError({
      statusCode: 401,
      message: 'Invalid or expired challenge',
    });
  }
  // One-shot: burn the challenge so a leaked proof can't be replayed.
  await redis.del(`login:${body.challenge}`);

  const row = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { authVerifier: true },
  });
  if (!row?.authVerifier) {
    throw createError({ statusCode: 401, message: 'Invalid credentials' });
  }

  // Same proof shape as login: SHA256(verifier + challenge).
  const expectedProof = createHash('sha256')
    .update(row.authVerifier + body.challenge)
    .digest('hex');

  if (!secureCompare(body.currentProof, expectedProof)) {
    throw createError({
      statusCode: 401,
      message: 'Current password is incorrect',
    });
  }

  await db
    .update(schema.users)
    .set({
      authSalt: body.newSalt,
      authVerifier: body.newVerifier,
    })
    .where(eq(schema.users.id, user.id));

  void notify(user.id, 'password_changed', null, '/settings');

  return { success: true };
});
