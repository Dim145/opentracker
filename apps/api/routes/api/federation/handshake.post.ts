/**
 * POST /api/federation/handshake  — inbound, server-to-server.
 *
 * A partner instance asks to federate with us. This is FIRST contact, so
 * we don't know them yet: we trust the public key carried in the body
 * (TOFU) only enough to prove the body wasn't tampered in transit and
 * that the advertised instanceId is genuinely the fingerprint of that
 * key. REAL trust is established later, by hand, when OUR owner approves
 * the resulting `pending_in` row (verifying the fingerprint out-of-band).
 *
 * Effect: upsert a `pending_in` peer + notify the owner. We reply with
 * our own identity so the caller can verify our future callback.
 */
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import {
  getFederationConfig,
  isFederationLive,
} from '~~/utils/federation/config';
import { verifySignedRequest } from '~~/utils/federation/signing';
import { computeInstanceId } from '~~/utils/federation/keys';
import { federationScopesSchema } from '~~/utils/federation/scopes';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { notify } from '~~/utils/notify';

const PATHNAME = '/api/federation/handshake';

const bodySchema = z.object({
  instanceId: z.string().min(3).max(64),
  publicKey: z.string().min(40).max(4000),
  baseUrl: z.string().url().max(255),
  name: z.string().max(120).optional().nullable(),
  scopesOffered: federationScopesSchema.optional(),
});

export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.mutation);

  const config = await getFederationConfig();
  if (!isFederationLive(config)) {
    throw createError({ statusCode: 404, message: 'Federation not enabled' });
  }

  // Read the EXACT bytes the digest is computed over before parsing.
  const rawBody = (await readRawBody(event, 'utf8')) || '';
  const headers = getRequestHeaders(event);

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(rawBody));
  } catch {
    throw createError({ statusCode: 400, message: 'Malformed handshake body' });
  }

  // The advertised instanceId MUST be the fingerprint of the supplied
  // key, else a caller could claim someone else's identity.
  if (computeInstanceId(parsed.publicKey) !== parsed.instanceId) {
    throw createError({
      statusCode: 400,
      message: 'instanceId does not match publicKey',
    });
  }
  if (parsed.instanceId === config!.instanceId) {
    throw createError({ statusCode: 400, message: 'Cannot federate with self' });
  }

  // TOFU verify: signature valid for the body-supplied key + header
  // instanceId matches the body.
  const verdict = verifySignedRequest({
    method: 'POST',
    pathname: PATHNAME,
    rawBody,
    headers,
    publicKeyPem: parsed.publicKey,
  });
  if (!verdict.ok || verdict.instanceId !== parsed.instanceId) {
    throw createError({
      statusCode: 401,
      message: `Signature rejected: ${verdict.reason ?? 'identity mismatch'}`,
    });
  }

  const now = new Date();
  const [existing] = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.instanceId, parsed.instanceId))
    .limit(1);

  if (existing) {
    // Re-handshake from a known peer: never silently re-open a hard link.
    if (existing.status === 'blocked' || existing.status === 'revoked') {
      throw createError({ statusCode: 403, message: 'Peer is blocked' });
    }
    await db
      .update(schema.federationPeers)
      .set({
        baseUrl: parsed.baseUrl,
        publicKey: parsed.publicKey,
        displayName: parsed.name ?? existing.displayName,
        lastHandshakeAt: now,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(schema.federationPeers.id, existing.id));
  } else {
    await db
      .insert(schema.federationPeers)
      .values({
        id: uuidv4(),
        baseUrl: parsed.baseUrl,
        instanceId: parsed.instanceId,
        publicKey: parsed.publicKey,
        displayName: parsed.name ?? null,
        status: 'pending_in',
        lastHandshakeAt: now,
        lastSeenAt: now,
      })
      // Same URL already linked under a different identity: ignore rather
      // than 500. The owner can resolve the conflict manually.
      .onConflictDoNothing({ target: schema.federationPeers.baseUrl });
  }

  // Notify the owner(s) — admins only (owner == admin in this model).
  const admins = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(and(eq(schema.users.isAdmin, true), eq(schema.users.isBanned, false)));
  await Promise.allSettled(
    admins.map((a) =>
      notify(
        a.id,
        'federation_request_received',
        {
          instanceName: parsed.name ?? parsed.baseUrl,
          baseUrl: parsed.baseUrl,
          fingerprint: parsed.instanceId,
        },
        '/admin/federation',
      ),
    ),
  );

  // Reply with our identity so the caller can trust our callback later.
  return {
    ok: true,
    status: 'pending_in',
    instance: {
      instanceId: config!.instanceId,
      publicKey: config!.publicKey,
      name: config!.instanceName ?? null,
    },
  };
});
