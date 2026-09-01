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
import { requireFreshAuth } from '~~/utils/adminAuth';
import {
  carryTorznabBlock,
  retireTorznabPasskey,
} from '~~/utils/torznabStats';
import { z } from 'zod';

const bodySchema = z.object({
  confirm: z.literal(true, {
    // The frontend sends `{ confirm: true }` after the user accepts the
    // confirmation dialog. We reject anything else so a CSRF attempt
    // with an empty body can't silently rotate the key.
    error: 'Passkey rotation must be confirmed',
  }),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  // The same step-up `me/passkey/reset` requires, and for the reason that route
  // states: a borrowed session must not be able to lock the real owner's client
  // out of the tracker. Two doors to the same action, one of them unguarded, is
  // just the unguarded one.
  await requireFreshAuth(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  await readValidatedBody(event, bodySchema.parse);

  // generateToken(16) returns 32 hex chars — same length the register
  // route uses, which matches the schema's `text` column expectations
  // and what BitTorrent clients pass through ?passkey=.
  const fresh = generateToken(16);

  // The row rather than the session. The session's copy of the passkey is
  // whatever was current when it was opened, so a member who rotated from
  // another device would have the block carried from a value that is already
  // dead — the entry would be written under a hash nobody presents, which
  // looks exactly like a successful carry-over and frees the member.
  const [current] = await db
    .select({ passkey: schema.users.passkey })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);

  if (!current) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    });
  }

  // Before the update, and refusing rather than failing open: the block is
  // keyed by passkey hash, so a rotation that dropped it would let a blocked
  // member self-lift an administrator's restriction by minting a new passkey.
  const carried = await carryTorznabBlock(current.passkey, fresh);

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

  // The old value is nobody's now — block entry and counters both go.
  await retireTorznabPasskey(current.passkey, carried);

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
