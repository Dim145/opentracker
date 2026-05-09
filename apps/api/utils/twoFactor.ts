/**
 * Shared helpers for the two-factor flows. Three things live here so
 * route handlers stay thin:
 *
 *   1. TOTP secret/verify wrappers around `otplib`. We pin SHA-1 + 6
 *      digits + 30-second windows because that's what every
 *      authenticator app on the planet expects (Google Authenticator,
 *      Authy, 1Password, Bitwarden). We allow ±1 step of clock drift
 *      so a user typing in the last second of a window doesn't fail.
 *
 *   2. Recovery codes. Generated as 10-character base32 (no `0/O/1/I`
 *      ambiguity), shown once at enrolment, persisted as sha-256
 *      hashes. Single-use: we set `used_at` instead of deleting so
 *      operators have an audit trail of which code was burned.
 *
 *   3. Fresh-auth window cache. After a full login (SRP + 2FA) we
 *      stamp `auth-fresh:{sessionId}` in Redis with a 10-minute TTL.
 *      Sensitive operations (disable 2FA, delete passkey, regenerate
 *      recovery codes) require both this window AND a 2FA challenge
 *      ("A+C" pattern) so a stolen session token alone can't strip a
 *      user's MFA.
 */
import { generateSecret, generateURI, verify as otpVerify } from 'otplib';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { redis } from '../redis/client';

// ── TOTP ─────────────────────────────────────────────────────
//
// otplib v13 ships an async-by-default crypto plugin (`@noble/hashes`),
// which means `verifySync` would silently return a Promise we can't
// chain on inside a synchronous helper. The early draft of this file
// did exactly that and every TOTP code came back rejected because
// `result.isValid` was `undefined` on a pending Promise.
//
// The async API is plenty fast (sub-ms HMAC) and keeps the code path
// honest: callers just `await verifyTotp(...)`. Defaults match what
// every authenticator app expects — SHA-1, 6 digits, 30 s period.

/** Generate a fresh base32 TOTP secret for a new enrolment. */
export function generateTotpSecret(): string {
  return generateSecret();
}

/**
 * Build the canonical `otpauth://` URI an authenticator app scans from
 * a QR code. The label follows the RFC 6238 / Google recommendation
 * `Issuer:account`. We pass period/digits/algorithm explicitly so a
 * misbehaving authenticator app can't fall back to non-standard
 * defaults.
 */
export function buildTotpUri(opts: {
  secret: string;
  username: string;
  issuer: string;
}): string {
  // otplib's `generateURI` already prepends `issuer:` to the label, so
  // we pass the username only — otherwise we'd end up with the
  // `Issuer:Issuer:user` double-prefix that some authenticator apps
  // display verbatim.
  return generateURI({
    secret: opts.secret,
    issuer: opts.issuer,
    label: opts.username,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
  });
}

/**
 * Verify a 6-digit code against the stored secret. Returns `true` for
 * any code valid in the ±30 s window (`window: 1`).
 *
 * otplib v13 returns `{ valid, delta, epoch, timeStep }` — note the
 * lowercase `valid`. The earlier `result.isValid` check silently
 * coerced to `false` for every code because the property doesn't
 * exist; callers saw "Invalid TOTP code" no matter what they typed.
 */
export async function verifyTotp(
  code: string,
  secret: string
): Promise<boolean> {
  if (!/^\d{6}$/.test(code.trim())) return false;
  try {
    const result = await otpVerify({
      token: code.trim(),
      secret,
      window: 1,
    });
    return !!result?.valid;
  } catch {
    return false;
  }
}

// ── Recovery codes ───────────────────────────────────────────

const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // RFC 4648-ish base32 minus 0/1/O/I
const RECOVERY_CODE_LENGTH = 10;
export const RECOVERY_CODE_COUNT = 8;

/**
 * Generate `n` cleartext recovery codes formatted as `XXXX-XXXXXX` so
 * they're readable when printed. The caller is expected to hash each
 * one (via `hashRecoveryCode`) before persisting; the cleartext is
 * shown to the user exactly once.
 *
 * Implementation note: we deliberately avoid `randomBytes(...)[i] %
 * ALPHABET.length`. Even though our 32-char alphabet happens to
 * divide 256 evenly (so the bias would be zero in practice), CodeQL
 * flags the pattern because the property silently breaks the moment
 * the alphabet length stops dividing 256 — e.g. dropping `Z` to land
 * at 31 chars would make `0..7` 13% more likely than `8..30`.
 *
 * `crypto.randomInt(max)` is the safe primitive: Node uses rejection
 * sampling internally so every value in `[0, max)` is equally
 * likely, regardless of `max`.
 */
export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let code = '';
    for (let j = 0; j < RECOVERY_CODE_LENGTH; j++) {
      code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    }
    // Hyphenate at the 4th char so both halves are visually balanced.
    out.push(`${code.slice(0, 4)}-${code.slice(4)}`);
  }
  return out;
}

/**
 * Hash a recovery code for storage. We deliberately use plain SHA-256
 * (not bcrypt/argon2) here: the codes are 10-char base32 with ~50 bits
 * of entropy each, generated server-side, never reused — bcrypt's
 * memory-hard cost would just slow login without adding meaningful
 * resistance, and we'd be doing N hash comparisons per recovery
 * attempt.
 */
export function hashRecoveryCode(code: string): string {
  return createHash('sha256')
    .update(code.replace(/-/g, '').toUpperCase())
    .digest('hex');
}

/**
 * Constant-time-ish comparison: same length so timing leaks can't tell
 * whether the prefix matched. (Strict constant time isn't critical for
 * our threat model since attackers don't get to enumerate codes — but
 * it costs nothing to be careful.)
 */
export function recoveryCodeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// ── Fresh-auth window ────────────────────────────────────────
//
// 10 minutes after a complete login, sensitive operations are allowed
// without an extra password prompt. Keys live in Redis so they expire
// automatically and survive a stateless API restart.

const FRESH_AUTH_TTL_S = 10 * 60;

function freshKey(sessionId: string) {
  return `auth:fresh:${sessionId}`;
}

/** Stamp the session as freshly authenticated. Call at end of 2FA verify. */
export async function markFreshAuth(sessionId: string): Promise<void> {
  await redis.setex(freshKey(sessionId), FRESH_AUTH_TTL_S, '1');
}

/** True if the session completed 2FA in the last 10 min. */
export async function isFreshAuth(sessionId: string): Promise<boolean> {
  const v = await redis.get(freshKey(sessionId));
  return v === '1';
}

/** Wipe the fresh stamp (e.g. on full logout). */
export async function clearFreshAuth(sessionId: string): Promise<void> {
  await redis.del(freshKey(sessionId));
}

// ── 2FA challenge tokens (between SRP and verify) ────────────
//
// Right after SRP succeeds, if the user has any 2FA method enabled, we
// don't open a session yet. Instead we mint a short-lived (5 min)
// signed token that pins the user id. The /auth/2fa/verify endpoint
// trades this token + a valid challenge response for a real session.

const CHALLENGE_TTL_S = 5 * 60;

function challengeKey(token: string) {
  return `auth:2fa-challenge:${token}`;
}

/**
 * Mint a fresh challenge token for `userId`. Stored in Redis with a 5-
 * minute TTL; consumed exactly once by `consumeChallengeToken`. We
 * keep tokens server-side rather than as JWTs because they're
 * short-lived and revoking them on success/failure is simpler that way.
 */
export async function mintChallengeToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await redis.setex(challengeKey(token), CHALLENGE_TTL_S, userId);
  return token;
}

/**
 * Trade a challenge token for the user id it pins. Returns null if the
 * token has expired, never existed, or has already been consumed. The
 * row is deleted on success so the same token can't be replayed.
 */
export async function consumeChallengeToken(
  token: string
): Promise<string | null> {
  const key = challengeKey(token);
  const userId = await redis.get(key);
  if (!userId) return null;
  await redis.del(key);
  return userId;
}
