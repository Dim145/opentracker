import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The bearer the browser presents to the relay.
 *
 * The relay cannot read a session — the seal is Iron, and re-implementing
 * that in Go would be the first of the thousand-odd lines of security
 * logic the split exists to avoid. So the API, which does have the
 * session, signs a statement the relay can check with an HMAC: "this user
 * may listen on their own channel".
 *
 * The byte format is a contract between two languages. It is pinned from
 * both sides by a golden value — `apps/relay/internal/token/token_test.go`
 * and `test/messagingToken.test.ts` assert the same string — because a
 * format described only in prose drifts, and the drift shows up as an
 * unexplained 401 rather than as a failing test.
 *
 * Field order matters: Go marshals the struct in declaration order, so the
 * object here has to be built `uid` then `exp`.
 */
export interface MessagingTokenClaims {
  uid: string;
  exp: number;
}

/**
 * Five minutes.
 *
 * The token travels in a query string, because `EventSource` cannot set a
 * header — a real trade, since a URL reaches proxy logs. The expiry is
 * what bounds it, and five minutes is the compromise between that and the
 * other requirement: a token has to outlive the failure of one relay node,
 * so twenty thousand reconnecting clients do not all ask the API for a new
 * one at the same instant. Making it single-use would defeat exactly that.
 */
export const MESSAGING_TOKEN_TTL_SECONDS = 300;

const b64url = (buf: Buffer) => buf.toString('base64url');

export function signMessagingToken(
  claims: MessagingTokenClaims,
  secret: string | Buffer
): string {
  const payload = b64url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signature = createHmac('sha256', secret).update(payload).digest();
  return `${payload}.${b64url(signature)}`;
}

/** Verification, for the tests and for anything server-side that needs it. */
export function verifyMessagingToken(
  raw: string,
  secret: string | Buffer,
  nowSeconds = Math.floor(Date.now() / 1000)
): MessagingTokenClaims | null {
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;

  const payloadPart = raw.slice(0, dot);
  const expected = createHmac('sha256', secret).update(payloadPart).digest();
  let given: Buffer;
  try {
    given = Buffer.from(raw.slice(dot + 1), 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;

  try {
    const claims = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf8')
    ) as MessagingTokenClaims;
    if (!claims?.uid || typeof claims.exp !== 'number') return null;
    if (nowSeconds >= claims.exp) return null;
    return claims;
  } catch {
    return null;
  }
}
