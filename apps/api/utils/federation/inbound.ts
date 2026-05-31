/**
 * Shared inbound guard for signed, scoped server-to-server endpoints.
 *
 * Every scoped S2S GET ran the same ~35-line preamble (IP rate-limit →
 * federation-live → sender header → allow-list lookup → active status →
 * required scope → signature). That duplication is the kind of thing where a
 * future fix lands in 6 of 7 copies. This centralises it — and adds two
 * defenses at the single chokepoint: a per-identity rate-limit (keyed on the
 * authenticated instanceId, so rotating egress IPs can't bypass it) and an
 * anti-replay check.
 *
 * handshake/callback are deliberately NOT covered (they bootstrap trust and
 * have bespoke status/signature rules) — but they call `assertNotReplayed`.
 */
import { createHash } from 'node:crypto';
import { createError, getRequestHeaders, type H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import type { FederationConfig, FederationPeer } from '@trackarr/db/schema';
import { redis } from '~~/utils/server';
import { rateLimit, rateLimitIdentity, RATE_LIMITS } from '~~/utils/rateLimit';
import { getFederationConfig, isFederationLive } from './config';
import { verifySignedRequest } from './signing';
import { SCOPE_KEYS } from './scopes';

type Scope = (typeof SCOPE_KEYS)[number];

const REPLAY_TTL_S = 6 * 60; // > the ±5 min signing clock-skew window
const REPLAY_PREFIX = 'fed:replay:';

/**
 * Reject a replayed signed request. Each S2S request carries a unique Ed25519
 * signature; we record it for the clock-skew window and refuse a duplicate.
 * Defense-in-depth over the ±5 min clock check (handlers are idempotent, but
 * this closes the protocol-level replay window). FAILS OPEN on a Redis outage
 * — availability over a belt-and-suspenders check.
 */
export async function assertNotReplayed(
  signature: string | undefined,
): Promise<void> {
  if (!signature) return;
  const key =
    REPLAY_PREFIX + createHash('sha256').update(signature).digest('base64url');
  let inserted = false;
  try {
    inserted = (await redis.set(key, '1', 'EX', REPLAY_TTL_S, 'NX')) === 'OK';
  } catch {
    return; // Redis hiccup → skip (fail open)
  }
  if (!inserted) {
    throw createError({ statusCode: 401, message: 'Replay detected' });
  }
}

export interface InboundContext {
  peer: FederationPeer;
  config: FederationConfig;
}

/**
 * Run the full inbound gauntlet for a signed, scoped S2S GET and return the
 * verified peer + config (or throw the right H3 error).
 */
export async function verifyInboundS2S(
  event: H3Event,
  scope: Scope,
): Promise<InboundContext> {
  await rateLimit(event, RATE_LIMITS.public);

  const config = await getFederationConfig();
  if (!isFederationLive(config)) {
    throw createError({ statusCode: 404, message: 'Federation not enabled' });
  }

  const headers = getRequestHeaders(event);
  const senderId = headers['x-trackarr-instance'];
  if (!senderId) {
    throw createError({ statusCode: 401, message: 'Missing instance header' });
  }

  const [peer] = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.instanceId, senderId))
    .limit(1);
  if (!peer || !peer.publicKey) {
    throw createError({ statusCode: 404, message: 'Unknown peer' });
  }
  if (peer.status !== 'active') {
    throw createError({ statusCode: 403, message: 'Peer not active' });
  }
  if (!peer.sharesWithThem?.[scope]) {
    throw createError({
      statusCode: 403,
      message: `${scope} not shared with this peer`,
    });
  }

  // Verify the signature BEFORE the per-identity rate-limit, so a forged
  // x-trackarr-instance header can't exhaust a victim peer's bucket.
  const verdict = verifySignedRequest({
    method: 'GET',
    pathname: event.path, // full path incl. query — matches what was signed
    rawBody: '',
    headers,
    publicKeyPem: peer.publicKey,
  });
  if (!verdict.ok) {
    throw createError({
      statusCode: 401,
      message: `Signature rejected: ${verdict.reason}`,
    });
  }

  // Per-identity rate-limit (on top of the IP limit above): keyed on the
  // stable, now-authenticated instanceId.
  await rateLimitIdentity(senderId, {
    windowSec: 60,
    maxRequests: 120,
    prefix: 'feds2s',
  });

  await assertNotReplayed(headers['x-trackarr-signature']);

  return { peer, config: config! };
}
