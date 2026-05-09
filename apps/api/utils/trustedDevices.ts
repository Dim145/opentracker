/**
 * Trusted-device cookie helpers.
 *
 * When the user has `users.trust_devices_enabled = true` and completes
 * a 2FA challenge, we issue a long-lived (30 days) cookie. On the next
 * login, if the cookie's hash matches a non-expired row in
 * `trusted_devices` for this user, we skip the 2FA step.
 *
 * Storage:
 *   - cookie value: random 32-byte url-safe token, set httpOnly +
 *     SameSite=Lax + Secure (when behind https; we trust the proxy
 *     already)
 *   - DB row: sha256(token) hex; the raw token only ever lives in
 *     the cookie
 *
 * Revocation:
 *   - the user can wipe a single device from settings
 *   - changing the password should also wipe all rows (a separate
 *     password-change handler will call `revokeAllForUser`)
 */
import { createHash, randomBytes } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import { and, eq, gt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export const TRUSTED_DEVICE_COOKIE = 'trackarr_td';
const COOKIE_TTL_S = 30 * 24 * 60 * 60; // 30 days

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Issue a fresh trusted-device row + cookie. Caller must have
 * verified the user is opted in (`trust_devices_enabled = true`).
 *
 * `label` is best-effort context (User-Agent excerpt) so the
 * settings page reads as "Firefox · macOS" instead of an opaque id.
 */
export async function issueTrustedDevice(
  event: any,
  userId: string,
  label: string | null
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + COOKIE_TTL_S * 1000);

  await db.insert(schema.trustedDevices).values({
    id: randomUUID(),
    userId,
    tokenHash: hashToken(token),
    label,
    expiresAt,
  });

  setCookie(event, TRUSTED_DEVICE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: COOKIE_TTL_S,
  });
}

/**
 * If the request carries a trusted-device cookie that matches a
 * non-expired row for `userId`, return the row id (so the caller
 * can bump `lastUsedAt`); otherwise null.
 *
 * We deliberately NOT return the row across user ids — a token
 * captured on user A's browser must not let an attacker bypass
 * user B's 2FA. The userId passed in is the SRP-validated subject.
 */
export async function consumeTrustedDevice(
  event: any,
  userId: string
): Promise<string | null> {
  const token = getCookie(event, TRUSTED_DEVICE_COOKIE);
  if (!token) return null;
  const hash = hashToken(token);
  const row = await db.query.trustedDevices.findFirst({
    where: and(
      eq(schema.trustedDevices.userId, userId),
      eq(schema.trustedDevices.tokenHash, hash),
      gt(schema.trustedDevices.expiresAt, new Date())
    ),
    columns: { id: true },
  });
  if (!row) return null;
  await db
    .update(schema.trustedDevices)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.trustedDevices.id, row.id));
  return row.id;
}

/** Clear the cookie + DB row (settings page "remove this device"). */
export async function revokeTrustedDevice(
  event: any,
  rowId: string,
  userId: string
): Promise<boolean> {
  const result = await db
    .delete(schema.trustedDevices)
    .where(
      and(
        eq(schema.trustedDevices.id, rowId),
        eq(schema.trustedDevices.userId, userId)
      )
    )
    .returning({ id: schema.trustedDevices.id });
  return result.length > 0;
}

/** Wipe every trusted device for this user (password change, panic). */
export async function revokeAllForUser(userId: string): Promise<void> {
  await db
    .delete(schema.trustedDevices)
    .where(eq(schema.trustedDevices.userId, userId));
}

/**
 * Expire-time GC — call from a cron tick to keep the table tidy.
 * The `expiresAt` index makes the scan cheap.
 */
export async function purgeExpired(): Promise<number> {
  const result = await db
    .delete(schema.trustedDevices)
    .where(gt(new Date() as any, schema.trustedDevices.expiresAt))
    .returning({ id: schema.trustedDevices.id });
  return result.length;
}
