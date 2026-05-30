/**
 * POST /api/admin/federation/peers
 *
 * Owner initiates an OUTBOUND handshake. We create a `pending_out` row
 * (so a failed send is retryable), then send our signed identity to the
 * partner's /api/federation/handshake. On a valid ACK we record the
 * partner's identity and wait for their owner to approve — which arrives
 * later via /api/federation/callback, flipping us to `active`.
 *
 * Body: { baseUrl, name?, scopes? }  (scopes = what we offer to share)
 */
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import {
  getFederationConfig,
  ensureFederationIdentity,
  getPrivateKeyPem,
} from '~~/utils/federation/config';
import { signedPost } from '~~/utils/federation/signing';
import { computeInstanceId } from '~~/utils/federation/keys';
import { federationScopesSchema } from '~~/utils/federation/scopes';

const bodySchema = z.object({
  baseUrl: z.string().trim().url().max(255),
  name: z.string().trim().max(120).optional().nullable(),
  scopes: federationScopesSchema.optional(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await validateBody(event, bodySchema);

  const config = await getFederationConfig();
  if (!config?.enabled) {
    throw createError({ statusCode: 400, message: 'Enable federation first' });
  }
  const live = await ensureFederationIdentity();
  const privateKeyPem = getPrivateKeyPem(live);
  if (!privateKeyPem || !live.instanceId || !live.publicKey) {
    throw createError({
      statusCode: 500,
      message: 'Federation identity not provisioned',
    });
  }

  // Normalise to origin (drops path / trailing slash).
  let baseUrl: string;
  try {
    baseUrl = new URL(body.baseUrl).origin;
  } catch {
    throw createError({ statusCode: 400, message: 'Invalid base URL' });
  }
  if (live.publicUrl && new URL(live.publicUrl).origin === baseUrl) {
    throw createError({ statusCode: 400, message: 'Cannot federate with self' });
  }

  const scopes = body.scopes ?? live.defaultScopes;
  const now = new Date();

  // Create / reset the pending_out row first.
  const [row] = await db
    .insert(schema.federationPeers)
    .values({
      id: uuidv4(),
      baseUrl,
      displayName: body.name ?? null,
      status: 'pending_out',
      sharesWithThem: scopes,
      createdBy: session.user.id,
      lastHandshakeAt: now,
    })
    .onConflictDoUpdate({
      target: schema.federationPeers.baseUrl,
      set: {
        sharesWithThem: scopes,
        status: 'pending_out',
        lastHandshakeAt: now,
        lastError: null,
        updatedAt: now,
      },
    })
    .returning();
  const peerId = row!.id;

  try {
    const res = await signedPost({
      baseUrl,
      pathname: '/api/federation/handshake',
      body: {
        instanceId: live.instanceId,
        publicKey: live.publicKey,
        baseUrl: live.publicUrl ?? '',
        name: live.instanceName ?? null,
        scopesOffered: scopes,
      },
      instanceId: live.instanceId,
      privateKeyPem,
    });

    if (res.status !== 200 || !res.data?.instance?.publicKey) {
      const msg = res.data?.message || `Handshake rejected (HTTP ${res.status})`;
      await db
        .update(schema.federationPeers)
        .set({ lastError: msg, updatedAt: new Date() })
        .where(eq(schema.federationPeers.id, peerId));
      throw createError({ statusCode: 502, message: msg });
    }

    const remote = res.data.instance;
    if (computeInstanceId(remote.publicKey) !== remote.instanceId) {
      await db
        .update(schema.federationPeers)
        .set({ lastError: 'Peer identity mismatch', updatedAt: new Date() })
        .where(eq(schema.federationPeers.id, peerId));
      throw createError({ statusCode: 502, message: 'Peer identity mismatch' });
    }

    await db
      .update(schema.federationPeers)
      .set({
        instanceId: remote.instanceId,
        publicKey: remote.publicKey,
        displayName: body.name ?? remote.name ?? null,
        lastError: null,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.federationPeers.id, peerId));

    return {
      ok: true,
      status: 'pending_out',
      peer: { id: peerId, baseUrl, instanceId: remote.instanceId },
    };
  } catch (err: any) {
    if (err?.statusCode) throw err; // already an H3 error
    const msg = err?.message || 'Handshake send failed';
    await db
      .update(schema.federationPeers)
      .set({ lastError: msg, updatedAt: new Date() })
      .where(eq(schema.federationPeers.id, peerId));
    throw createError({ statusCode: 502, message: msg });
  }
});
