/**
 * GET /api/federation/remote-forum  — authenticated.
 *
 * Aggregates recent forum topics from every active peer that shares its
 * `social` with us (fan-out, best-effort — a failing/slow peer is skipped).
 * Read-only: topics link back to their origin instance to read/reply.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from '~~/utils/federation/config';
import { signedGet } from '~~/utils/federation/signing';

interface RemoteTopic {
  title: string;
  categoryName: string | null;
  authorName: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  url: string | null;
}

export default defineEventHandler(async (event) => {
  await requireAuthSession(event);

  const config = await getFederationConfig();
  if (!isFederationLive(config)) return { peers: [] };
  const pk = getPrivateKeyPem(config!);
  if (!pk || !config!.instanceId) return { peers: [] };
  const instanceId = config!.instanceId;

  const peers = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.status, 'active'));
  const social = peers.filter((p) => p.acceptsFromThem?.social);

  const results = await Promise.allSettled(
    social.map(async (peer) => {
      const res = await signedGet({
        baseUrl: peer.baseUrl,
        pathname: '/api/federation/forum',
        instanceId,
        privateKeyPem: pk,
        timeoutMs: 8000,
      });
      const topics: RemoteTopic[] =
        res.status === 200 && Array.isArray(res.data?.topics)
          ? (res.data.topics as RemoteTopic[]).slice(0, 30)
          : [];
      return {
        peerId: peer.id,
        peerName: peer.displayName,
        peerBaseUrl: peer.baseUrl,
        topics,
      };
    }),
  );

  const out = results
    .filter(
      (r): r is PromiseFulfilledResult<{
        peerId: string;
        peerName: string | null;
        peerBaseUrl: string;
        topics: RemoteTopic[];
      }> => r.status === 'fulfilled',
    )
    .map((r) => r.value)
    .filter((p) => p.topics.length > 0);

  return { peers: out };
});
