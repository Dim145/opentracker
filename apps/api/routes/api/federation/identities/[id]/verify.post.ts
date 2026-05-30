/**
 * POST /api/federation/identities/:id/verify  — authenticated.
 *
 * Calls the partner's verify-identity endpoint (signed) to confirm our
 * verification code is in the user's remote bio. On success the link flips
 * to `verified` and the code is cleared.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from '~~/utils/federation/config';
import { signedGet } from '~~/utils/federation/signing';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const [idn] = await db
    .select()
    .from(schema.federatedIdentities)
    .where(
      and(
        eq(schema.federatedIdentities.id, id),
        eq(schema.federatedIdentities.localUserId, session.user.id),
      ),
    )
    .limit(1);
  if (!idn) throw createError({ statusCode: 404, message: 'Identity link not found' });
  if (idn.status === 'verified') return { ok: true, verified: true };
  if (!idn.verifyCode) {
    throw createError({ statusCode: 400, message: 'No verification code on this link' });
  }

  const [peer] = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.id, idn.peerId))
    .limit(1);
  if (!peer || peer.status !== 'active') {
    throw createError({ statusCode: 400, message: 'Peer is not active' });
  }

  const config = await getFederationConfig();
  if (!isFederationLive(config)) {
    throw createError({ statusCode: 400, message: 'Federation not enabled' });
  }
  const pk = getPrivateKeyPem(config!);
  if (!pk || !config!.instanceId) {
    throw createError({ statusCode: 500, message: 'Federation identity not provisioned' });
  }

  let matched = false;
  try {
    const res = await signedGet({
      baseUrl: peer.baseUrl,
      pathname: `/api/federation/verify-identity?username=${encodeURIComponent(idn.remoteUsername)}&code=${encodeURIComponent(idn.verifyCode)}`,
      instanceId: config!.instanceId,
      privateKeyPem: pk,
    });
    matched = res.status === 200 && res.data?.matched === true;
  } catch (err: unknown) {
    throw createError({
      statusCode: 502,
      message: `Verification call failed: ${(err as Error)?.message ?? 'network error'}`,
    });
  }

  if (matched) {
    await db
      .update(schema.federatedIdentities)
      .set({ status: 'verified', verifiedAt: new Date(), verifyCode: null })
      .where(eq(schema.federatedIdentities.id, id));
  }
  return { ok: true, verified: matched };
});
