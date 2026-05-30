/**
 * POST /api/admin/federation/peers/:id/approve
 *
 * Owner approves an INBOUND (`pending_in`) handshake. We set the link
 * active with the chosen scopes, then call the partner back at
 * /api/federation/callback (signed) so their side flips active too.
 *
 * Scope mapping for the callback (our perspective → theirs):
 *   acceptsFromYou = what WE accept from them → their `sharesWithThem`
 *   sharesWithYou  = what WE send them        → their `acceptsFromThem`
 *
 * Body: { sharesWithThem?, acceptsFromThem? }
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import {
  ensureFederationIdentity,
  getPrivateKeyPem,
} from '~~/utils/federation/config';
import { signedPost } from '~~/utils/federation/signing';
import { federationScopesSchema } from '~~/utils/federation/scopes';

const bodySchema = z.object({
  sharesWithThem: federationScopesSchema.optional(),
  acceptsFromThem: federationScopesSchema.optional(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const peerId = getRouterParam(event, 'id');
  if (!peerId) throw createError({ statusCode: 400, message: 'Missing peer id' });
  const body = await validateBody(event, bodySchema);

  const [peer] = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.id, peerId))
    .limit(1);
  if (!peer) throw createError({ statusCode: 404, message: 'Peer not found' });
  if (peer.status !== 'pending_in') {
    throw createError({
      statusCode: 400,
      message: 'Peer is not awaiting approval',
    });
  }
  if (!peer.publicKey || !peer.instanceId) {
    throw createError({ statusCode: 400, message: 'Peer identity missing' });
  }

  const live = await ensureFederationIdentity();
  const privateKeyPem = getPrivateKeyPem(live);
  if (!privateKeyPem || !live.instanceId) {
    throw createError({
      statusCode: 500,
      message: 'Federation identity not provisioned',
    });
  }

  const sharesWithThem = body.sharesWithThem ?? peer.sharesWithThem;
  const acceptsFromThem = body.acceptsFromThem ?? live.defaultScopes;
  const now = new Date();

  await db
    .update(schema.federationPeers)
    .set({
      status: 'active',
      sharesWithThem,
      acceptsFromThem,
      createdBy: peer.createdBy ?? session.user.id,
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(schema.federationPeers.id, peerId));

  // Inform the peer (best-effort). The link is active on our side
  // regardless; a failed callback is recorded for a later retry.
  try {
    await signedPost({
      baseUrl: peer.baseUrl,
      pathname: '/api/federation/callback',
      body: { acceptsFromYou: acceptsFromThem, sharesWithYou: sharesWithThem },
      instanceId: live.instanceId,
      privateKeyPem,
    });
    await db
      .update(schema.federationPeers)
      .set({ lastError: null, updatedAt: new Date() })
      .where(eq(schema.federationPeers.id, peerId));
  } catch (err: any) {
    await db
      .update(schema.federationPeers)
      .set({
        lastError: `Callback failed: ${err?.message ?? 'network error'}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.federationPeers.id, peerId));
  }

  return { ok: true, status: 'active' };
});
