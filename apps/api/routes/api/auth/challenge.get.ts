/**
 * GET /api/auth/challenge
 * Get salt and login challenge for a username
 * Returns fake data for non-existent users to prevent enumeration
 */
import { eq } from 'drizzle-orm';
import { randomBytes, createHmac } from 'crypto';
import { db } from '@trackarr/db';
import { users } from '@trackarr/db/schema';
import { redis } from '~~/utils/server';
import { rateLimit } from '~~/utils/rateLimit';
import { UNKNOWN_ACCOUNT_CHALLENGE } from '~~/utils/loginChallenge';

const CHALLENGE_TTL = 300; // 5 minutes

/**
 * 20 challenges per 5 min per address (an IPv6 /64), WITHOUT the progressive
 * penalty. That penalty puts the whole address on the blacklist, every route
 * included: on a VPN exit or a carrier NAT, twenty-one requests from one
 * stranger signed everybody else out of the site — the reason the sign-in
 * itself left it (`RATE_LIMITS.signin`).
 */
const CHALLENGE_LIMIT = {
  windowSec: 300,
  maxRequests: 20,
  prefix: 'challenge',
} as const;

// Stable per-process key for deriving the *fake* salt of non-existent
// accounts. Prefer NUXT_SESSION_SECRET (always set, >=32 chars); fall
// back to a process-lifetime random so we never throw on this hot
// login path. See `fakeSaltFor` below.
const FAKE_SALT_KEY =
  process.env.NUXT_SESSION_SECRET || randomBytes(32).toString('hex');

/**
 * Deterministic fake salt for a username that doesn't exist.
 *
 * A real account always returns the same stored `authSalt`, so if a
 * non-existent account returned a fresh random salt on every request
 * an attacker could enumerate the member roster by simply asking for
 * the same username twice and checking whether the salt changed
 * (finding M1). Deriving the fake salt as HMAC(secret, username)
 * makes it stable-yet-unpredictable, collapsing that oracle: both
 * branches now look identical across repeated requests.
 */
function fakeSaltFor(username: string): string {
  return createHmac('sha256', FAKE_SALT_KEY)
    .update(`login-salt:${username.toLowerCase()}`)
    .digest('base64');
}

export default defineEventHandler(async (event) => {
  // The only auth route that had no limit. Enumeration is already closed by
  // the deterministic fake salt, but every call still costs a `SELECT` on
  // `users` AND writes a Redis key with a 5-minute TTL, for unknown usernames
  // too. Unbounded, that is a slow memory drain on Redis for the price of an
  // unauthenticated GET.
  //
  // More generous than RATE_LIMITS.auth: a challenge is not an attempt, and a
  // legitimate client fetches one per login screen, sometimes twice if the
  // user retypes their name.
  await rateLimit(event, CHALLENGE_LIMIT);
  const query = getQuery(event);
  const username = (query.username as string)?.trim();
  
  if (!username) {
    throw createError({
      statusCode: 400,
      message: 'Username is required',
    });
  }
  
  // Find user
  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
    columns: { 
      id: true,
      authSalt: true,
    },
  });
  
  // Generate challenge regardless of user existence
  const challenge = randomBytes(32).toString('hex');
  
  if (!user || !user.authSalt) {
    // Return a DETERMINISTIC fake salt (stable per username) so an
    // attacker can't tell real from fake by requesting twice and
    // diffing the salt (finding M1).
    //
    // Stored under the SAME key as a real challenge. It used to go to
    // `login:fake:*`, which the login never reads: an unknown username was
    // answered "Invalid or expired challenge" and a known one with a wrong
    // proof "Invalid credentials" — the roster the fake salt was hiding, read
    // off the error message instead.
    const fakeSalt = fakeSaltFor(username);
    await redis.set(`login:${challenge}`, UNKNOWN_ACCOUNT_CHALLENGE, 'EX', CHALLENGE_TTL);
    return { salt: fakeSalt, challenge };
  }
  
  // Store challenge with user ID association
  await redis.set(`login:${challenge}`, user.id, 'EX', CHALLENGE_TTL);
  
  return { 
    salt: user.authSalt, 
    challenge,
  };
});
