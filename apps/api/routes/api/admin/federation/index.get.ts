/**
 * GET /api/admin/federation
 *
 * Owner console payload: this instance's config + verifiable identity
 * (never the private key) and the full peer allow-list. Short
 * fingerprints are derived on the fly for the out-of-band verify UI.
 */
import { desc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { getFederationConfig } from '~~/utils/federation/config';
import { shortFingerprint } from '~~/utils/federation/keys';
import { EMPTY_SCOPES } from '~~/utils/federation/scopes';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const config = await getFederationConfig();
  const peers = await db
    .select()
    .from(schema.federationPeers)
    .orderBy(desc(schema.federationPeers.createdAt));

  return {
    config: config
      ? {
          enabled: config.enabled,
          instanceName: config.instanceName,
          publicUrl: config.publicUrl,
          instanceId: config.instanceId,
          publicKey: config.publicKey,
          fingerprint: config.publicKey
            ? shortFingerprint(config.publicKey)
            : null,
          defaultScopes: config.defaultScopes,
          provisioned: !!(config.instanceId && config.publicKey),
        }
      : {
          enabled: false,
          instanceName: null,
          publicUrl: null,
          instanceId: null,
          publicKey: null,
          fingerprint: null,
          defaultScopes: EMPTY_SCOPES,
          provisioned: false,
        },
    peers: peers.map((p) => ({
      id: p.id,
      baseUrl: p.baseUrl,
      instanceId: p.instanceId,
      displayName: p.displayName,
      status: p.status,
      sharesWithThem: p.sharesWithThem,
      acceptsFromThem: p.acceptsFromThem,
      fingerprint: p.publicKey ? shortFingerprint(p.publicKey) : null,
      lastHandshakeAt: p.lastHandshakeAt,
      lastSeenAt: p.lastSeenAt,
      lastError: p.lastError,
      createdAt: p.createdAt,
    })),
  };
});
