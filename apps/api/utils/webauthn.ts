/**
 * WebAuthn / passkey config and challenge cache.
 *
 * `rpID` is the bare hostname the relying party identifies itself as
 * (no protocol, no port). `origin` is the full URL the browser sees
 * — it must include scheme + port. Both are derived from
 * `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` env vars when set, otherwise
 * inferred from the request host. We keep them in helpers so every
 * route uses the same source of truth.
 *
 * Challenges (random per-ceremony nonces) are stored in Redis with a
 * 5-minute TTL keyed on user (registration) or browser session
 * (login). We deliberately don't store them in `webauthn_credentials`
 * — they're transient and replay-resistant by virtue of being
 * one-shot.
 */
import { redis } from '../redis/client';

export const RP_NAME = process.env.TRACKARR_NAME || 'Trackarr';

/**
 * The relying-party identifier passed to navigator.credentials.* on
 * the client. MUST be the bare hostname (no scheme, no port). It also
 * scopes which sites a passkey is valid for: a credential created at
 * `tracker.example.com` only authenticates at exactly that host (or
 * a same-origin subdomain if rpId is set to a parent domain — we
 * deliberately don't, to keep the scoping tight).
 */
export function rpID(event: any): string {
  const fromEnv = process.env.WEBAUTHN_RP_ID;
  if (fromEnv) return fromEnv.trim();
  const host = (getHeader(event, 'host') || '').split(':')[0];
  return host || 'localhost';
}

/**
 * The origin the browser will report in the assertion. Must include
 * scheme and port if non-default. Derived from `X-Forwarded-Proto`
 * (Caddy in front) when present so the "did the browser see https?"
 * check doesn't fail on local http loops.
 */
export function rpOrigin(event: any): string {
  const fromEnv = process.env.WEBAUTHN_ORIGIN;
  if (fromEnv) return fromEnv.trim();
  const proto = getHeader(event, 'x-forwarded-proto') || 'https';
  const host = getHeader(event, 'host') || 'localhost';
  return `${proto}://${host}`;
}

const CHALLENGE_TTL_S = 5 * 60;

function regKey(userId: string) {
  return `webauthn:reg:${userId}`;
}
function authKey(token: string) {
  return `webauthn:auth:${token}`;
}

/** Persist a registration challenge keyed on user id. */
export async function setRegistrationChallenge(
  userId: string,
  challenge: string
): Promise<void> {
  await redis.setex(regKey(userId), CHALLENGE_TTL_S, challenge);
}
export async function getRegistrationChallenge(
  userId: string
): Promise<string | null> {
  return redis.get(regKey(userId));
}
export async function clearRegistrationChallenge(
  userId: string
): Promise<void> {
  await redis.del(regKey(userId));
}

/**
 * Authentication (login) challenge keyed on the short-lived 2FA
 * challenge token rather than a user id — at this stage we don't
 * have a logged-in session yet, just the token returned by the SRP
 * endpoint.
 */
export async function setAuthChallenge(
  token: string,
  challenge: string
): Promise<void> {
  await redis.setex(authKey(token), CHALLENGE_TTL_S, challenge);
}
export async function getAuthChallenge(token: string): Promise<string | null> {
  return redis.get(authKey(token));
}
export async function clearAuthChallenge(token: string): Promise<void> {
  await redis.del(authKey(token));
}
