/**
 * POST /api/federation/callback  — inbound, server-to-server.
 *
 * A peer we previously sent a handshake to (status `pending_out`) has had
 * its owner approve the link. They call us back, signed with the key we
 * already learned during their ACK, telling us the scopes they granted.
 * We flip the link to `active`.
 *
 * Scope mapping (their perspective → ours):
 *   acceptsFromYou  = what THEY accept from us  → our `sharesWithThem`
 *   sharesWithYou   = what THEY send us          → our `acceptsFromThem`
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import {
  getFederationConfig,
  isFederationLive,
} from '~~/utils/federation/config';
import { verifySignedRequest } from '~~/utils/federation/signing';
import { federationScopesSchema } from '~~/utils/federation/scopes';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { assertNotReplayed } from '~~/utils/federation/inbound';
import { evaluateCallback } from '~~/utils/federation/peerLifecycle';

const PATHNAME = '/api/federation/callback';

const bodySchema = z.object({
  acceptsFromYou: federationScopesSchema.optional(),
  sharesWithYou: federationScopesSchema.optional(),
});

export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.mutation);

  const config = await getFederationConfig();
  if (!isFederationLive(config)) {
    throw createError({ statusCode: 404, message: 'Federation not enabled' });
  }

  const rawBody = (await readRawBody(event, 'utf8')) || '';
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
  if (peer.status === 'blocked' || peer.status === 'revoked') {
    throw createError({ statusCode: 403, message: 'Peer is blocked' });
  }

  const verdict = verifySignedRequest({
    method: 'POST',
    pathname: PATHNAME,
    rawBody,
    headers,
    publicKeyPem: peer.publicKey,
  });
  if (!verdict.ok) {
    throw createError({
      statusCode: 401,
      message: `Signature rejected: ${verdict.reason}`,
    });
  }
  await assertNotReplayed(headers['x-trackarr-signature']);

  // A callback only ever COMPLETES an outbound handshake we initiated. If the
  // link is already active, ACK idempotently WITHOUT rewriting the scopes our
  // owner agreed to; any other state means there is no outbound handshake
  // awaiting confirmation (centralised in peerLifecycle.evaluateCallback).
  const decision = evaluateCallback(peer.status);
  if (decision === 'idempotent') {
    return { ok: true, status: 'active' };
  }
  if (decision === 'reject') {
    throw createError({
      statusCode: 409,
      message: 'No outbound handshake awaiting confirmation',
    });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(rawBody ? JSON.parse(rawBody) : {});
  } catch {
    throw createError({ statusCode: 400, message: 'Malformed callback body' });
  }

  // What we share with them is clamped to what our owner ORIGINALLY offered
  // (the scopes set on the pending_out row). The callback only tells us what
  // the peer accepts — it must never widen our share beyond the offer, or a
  // peer could self-grant e.g. `swarm` (peer-IP exposure) we never agreed to.
  const offered = peer.sharesWithThem ?? EMPTY_SCOPES;
  const sharesWithThem = parsed.acceptsFromYou
    ? intersectScopes(offered, parsed.acceptsFromYou)
    : offered;

  const now = new Date();
  await db
    .update(schema.federationPeers)
    .set({
      status: 'active',
      sharesWithThem,
      acceptsFromThem: parsed.sharesWithYou ?? peer.acceptsFromThem,
      lastSeenAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(schema.federationPeers.id, peer.id));

  return { ok: true, status: 'active' };
});
