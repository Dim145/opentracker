/**
 * GET /api/me/federated-identities  — authenticated.
 *
 * The caller's linked remote identities. For verified links we pull the
 * partner's reputation snapshot (best-effort, requires the accounts scope).
 */
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from '~~/utils/federation/config';
import { signedGet } from '~~/utils/federation/signing';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);

  const rows = await db
    .select({
      id: schema.federatedIdentities.id,
      peerId: schema.federatedIdentities.peerId,
      remoteUsername: schema.federatedIdentities.remoteUsername,
      status: schema.federatedIdentities.status,
      verifyCode: schema.federatedIdentities.verifyCode,
      verifiedAt: schema.federatedIdentities.verifiedAt,
      peerName: schema.federationPeers.displayName,
      peerBaseUrl: schema.federationPeers.baseUrl,
      peerStatus: schema.federationPeers.status,
      acceptsFromThem: schema.federationPeers.acceptsFromThem,
    })
    .from(schema.federatedIdentities)
    .innerJoin(
      schema.federationPeers,
      eq(schema.federatedIdentities.peerId, schema.federationPeers.id),
    )
    .where(eq(schema.federatedIdentities.localUserId, session.user.id))
    .orderBy(desc(schema.federatedIdentities.createdAt));

  const config = await getFederationConfig();
  const live = isFederationLive(config);
  const pk = live ? getPrivateKeyPem(config!) : null;

  const identities = await Promise.all(
    rows.map(async (r) => {
      let reputation: unknown = null;
      if (
        r.status === 'verified' &&
        live &&
        pk &&
        config!.instanceId &&
        r.peerStatus === 'active' &&
        r.acceptsFromThem?.accounts
      ) {
        try {
          const res = await signedGet({
            baseUrl: r.peerBaseUrl,
            pathname: `/api/federation/user-reputation?username=${encodeURIComponent(r.remoteUsername)}`,
            instanceId: config!.instanceId,
            privateKeyPem: pk,
            timeoutMs: 8000,
          });
          if (res.status === 200 && res.data?.reputation) {
            reputation = res.data.reputation;
          }
        } catch {
          /* best-effort */
        }
      }
      return {
        id: r.id,
        peerId: r.peerId,
        peerName: r.peerName,
        peerBaseUrl: r.peerBaseUrl,
        remoteUsername: r.remoteUsername,
        status: r.status,
        verifyCode: r.verifyCode,
        verifiedAt: r.verifiedAt,
        reputation,
      };
    }),
  );

  return { identities };
});
