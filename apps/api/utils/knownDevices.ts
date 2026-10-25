/**
 * Known-device cookies: the per-account sign-in lockout, minus the member's own
 * browsers.
 *
 * Ten failed sign-ins in fifteen minutes hold a username out of password
 * sign-in from every address (`assertAccountNotLocked`). That is what stops a
 * guess spread over many addresses, and it let anyone who knows a username —
 * on a tracker, everyone — keep its owner out with one failure every ninety
 * seconds, the right password included.
 *
 * A browser that completes a sign-in gets this cookie. It vouches for nothing
 * but "this browser has proven this account's password before", so it skips
 * nothing: not the password, not the second factor, not the per-address limit.
 * What it changes is which counter a sign-in answers to — the device's own
 * instead of the account's. A stranger failing on purpose can still hold the
 * account shut to new devices; no longer to the member's usual ones. Guessing
 * meets the same wall as before, since a guesser never holds a valid cookie.
 *
 * Not to be confused with `trustedDevices.ts`, which is opt-in, stored in the
 * database, and DOES skip the second factor.
 *
 * Stateless: the value is an HMAC over the account id, `users.session_epoch`,
 * a fingerprint of the stored verifier, a random device id and the issue time.
 * So "sign out everywhere" and a ban (the epoch) revoke every such cookie at
 * once, and so does a password change (the verifier). Server side, only Redis
 * keeps anything: a failure counter per device id, and the ids revoked after
 * ten failures — a stolen cookie is worth ten guesses, once.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users } from '@trackarr/db/schema';
import { redis } from './server';

export const KNOWN_DEVICE_COOKIE = 'trackarr_kd';

/** Long enough to outlive the seven-day session many times over. */
export const KNOWN_DEVICE_TTL_S = 180 * 24 * 60 * 60;

/** How far in the future an issue time may sit: clock skew between replicas. */
const FUTURE_SKEW_S = 5 * 60;

// Same window and threshold as the account's own counter.
const DEVICE_FAILURE_WINDOW_S = 15 * 60;
const DEVICE_MAX_FAILURES = 10;

const failureKey = (deviceId: string) => `ratelimit:signin-fail-device:${deviceId}`;
const revokedKey = (deviceId: string) => `known-device:revoked:${deviceId}`;

/** What a cookie is bound to. Any of these changing voids it. */
export interface KnownDeviceSubject {
  userId: string;
  sessionEpoch: number | null | undefined;
  /** The stored column as is, ciphertext included: it changes when the password does. */
  authVerifier: string | null | undefined;
}

const VALUE = /^v1\.([A-Za-z0-9_-]{22})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

let cachedKey: { secret: string; key: Buffer } | null = null;

/** A key of its own, derived from the session secret rather than reusing it as is. */
function signingKey(): Buffer {
  const secret = process.env.NUXT_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('NUXT_SESSION_SECRET must be set and at least 32 characters long');
  }
  if (cachedKey?.secret !== secret) {
    cachedKey = {
      secret,
      key: createHmac('sha256', secret).update('trackarr known-device cookie v1').digest(),
    };
  }
  return cachedKey.key;
}

function mac(subject: KnownDeviceSubject, deviceId: string, issuedAt: number): string {
  const credential = createHash('sha256')
    .update(subject.authVerifier ?? '')
    .digest('base64url');
  return createHmac('sha256', signingKey())
    .update(
      `known-device|${subject.userId}|${subject.sessionEpoch ?? 0}|${credential}|${deviceId}|${issuedAt}`,
    )
    .digest('base64url');
}

/** The cookie value for `subject`. Exported for the tests. */
export function encodeKnownDevice(
  subject: KnownDeviceSubject,
  deviceId: string,
  issuedAt: number,
): string {
  return `v1.${deviceId}.${issuedAt}.${mac(subject, deviceId, issuedAt)}`;
}

/**
 * The device id `value` carries, if it was issued for `subject` and has not
 * outlived its life. Format, signature and age only: revocation is Redis's
 * business, see `knownDeviceFor`.
 */
export function verifyKnownDevice(
  value: string | null | undefined,
  subject: KnownDeviceSubject,
  now: number = Math.floor(Date.now() / 1000),
): string | null {
  const m = value ? VALUE.exec(value) : null;
  if (!m) return null;
  const [, deviceId = '', issued = '', given = ''] = m;
  const issuedAt = Number(issued);
  if (issuedAt > now + FUTURE_SKEW_S || now - issuedAt > KNOWN_DEVICE_TTL_S) return null;
  const expected = Buffer.from(mac(subject, deviceId, issuedAt));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return deviceId;
}

/**
 * The device id of a valid, unrevoked known-device cookie for `username`, or
 * null. Reads the account only when there is a cookie to check, so a sign-in
 * without one costs nothing more than before.
 *
 * Fails closed on a Redis error: a device whose revocation cannot be checked is
 * treated as unknown, which is what every browser was before this existed.
 */
export async function knownDeviceFor(
  value: string | null | undefined,
  username: string,
): Promise<string | null> {
  if (!value || !VALUE.test(value)) return null;
  const user = await db
    .select({ id: users.id, sessionEpoch: users.sessionEpoch, authVerifier: users.authVerifier })
    .from(users)
    .where(eq(users.username, username))
    .limit(1)
    .then((r) => r[0]);
  if (!user) return null;
  const deviceId = verifyKnownDevice(value, {
    userId: user.id,
    sessionEpoch: user.sessionEpoch,
    authVerifier: user.authVerifier,
  });
  if (!deviceId) return null;
  try {
    if (await redis.exists(revokedKey(deviceId))) return null;
  } catch {
    return null;
  }
  return deviceId;
}

/** `knownDeviceFor` on the cookie this request carries. */
export function readKnownDevice(event: H3Event, username: string): Promise<string | null> {
  return knownDeviceFor(getCookie(event, KNOWN_DEVICE_COOKIE), username);
}

/**
 * One failed sign-in from a known device. The tenth inside the window revokes
 * its id for good: from then on the browser is unknown, and answers to the
 * account's counter like any other.
 */
export async function recordKnownDeviceFailure(deviceId: string): Promise<void> {
  const key = failureKey(deviceId);
  const now = Date.now();
  try {
    const results = await redis
      .multi()
      .zadd(key, now, `${now}:${randomBytes(6).toString('hex')}`)
      .zremrangebyscore(key, 0, now - DEVICE_FAILURE_WINDOW_S * 1000)
      .expire(key, DEVICE_FAILURE_WINDOW_S)
      .zcard(key)
      .exec();
    // [error, reply] per command; the fourth is the count after the trim.
    if (Number(results?.[3]?.[1] ?? 0) >= DEVICE_MAX_FAILURES) {
      await redis.set(revokedKey(deviceId), '1', 'EX', KNOWN_DEVICE_TTL_S);
    }
  } catch {
    /* best effort, like the account's counter */
  }
}

/**
 * Hand this browser a fresh known-device cookie once a sign-in is complete —
 * session open, second factor met. A new device id each time, so an id revoked
 * on this browser is never carried forward.
 */
export function issueKnownDevice(event: H3Event, subject: KnownDeviceSubject): void {
  const deviceId = randomBytes(16).toString('base64url');
  setCookie(
    event,
    KNOWN_DEVICE_COOKIE,
    encodeKnownDevice(subject, deviceId, Math.floor(Date.now() / 1000)),
    {
      httpOnly: true,
      sameSite: 'lax',
      // As the session cookie: a plain-HTTP development stack would never get it back.
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: KNOWN_DEVICE_TTL_S,
    },
  );
}
