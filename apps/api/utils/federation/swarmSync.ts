/**
 * Swarm sync — pulls partner peers into `remote_peers:{infoHash}` for the Go
 * tracker to mix into announce responses (Phase 4 cross-announce).
 *
 * For each LOCAL torrent opted in to swarm federation (`federate_swarm`), and
 * each active peer we accept swarm from (`acceptsFromThem.swarm`), pull the
 * partner's peers (signed) and write a deduped JSON array (PeerData-shaped) to
 * Redis with a short TTL. The tracker reads it behind TRACKER_FEDERATION_SWARM.
 *
 * Best-effort: a failing peer is skipped; an empty result clears the cache.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { redis } from '../server';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from './config';
import { signedGet } from './signing';

const CACHE_TTL_S = 900; // 15 min — refreshed each sync tick
const MAX_PER_TORRENT = 300;

interface CachedPeer {
  peerId: string;
  ip: string;
  port: number;
  isSeeder: boolean;
  updatedAt: number;
}

export async function syncSwarmPeers(): Promise<{ torrents: number; peers: number }> {
  const config = await getFederationConfig();
  if (!isFederationLive(config)) return { torrents: 0, peers: 0 };
  const pk = getPrivateKeyPem(config!);
  if (!pk || !config!.instanceId) return { torrents: 0, peers: 0 };
  const instanceId = config!.instanceId;

  const localTorrents = await db
    .select({ infoHash: schema.torrents.infoHash })
    .from(schema.torrents)
    .where(
      and(
        eq(schema.torrents.federateSwarm, true),
        eq(schema.torrents.moderationStatus, 'accepted'),
        eq(schema.torrents.isActive, true),
      ),
    );
  if (!localTorrents.length) return { torrents: 0, peers: 0 };

  const peers = (
    await db
      .select()
      .from(schema.federationPeers)
      .where(eq(schema.federationPeers.status, 'active'))
  ).filter((p) => p.acceptsFromThem?.swarm);
  if (!peers.length) return { torrents: localTorrents.length, peers: 0 };

  let totalPeers = 0;
  const nowMs = Date.now();

  for (const t of localTorrents) {
    const collected: CachedPeer[] = [];
    for (const peer of peers) {
      try {
        const res = await signedGet({
          baseUrl: peer.baseUrl,
          pathname: `/api/federation/peers?infoHash=${t.infoHash}`,
          instanceId,
          privateKeyPem: pk,
          timeoutMs: 8000,
        });
        if (res.status === 200 && Array.isArray(res.data?.peers)) {
          for (const rp of res.data.peers as unknown[]) {
            const o = rp as Record<string, unknown>;
            const ip = typeof o.ip === 'string' ? o.ip : '';
            const port = typeof o.port === 'number' ? o.port : 0;
            if (!ip || port <= 0 || port > 65535) continue;
            collected.push({
              peerId: '',
              ip,
              port,
              isSeeder: !!o.isSeeder,
              updatedAt: nowMs,
            });
          }
        }
      } catch {
        /* skip this peer */
      }
    }

    const key = `remote_peers:${t.infoHash}`;
    if (!collected.length) {
      await redis.del(key).catch(() => {});
      continue;
    }
    // Dedup by ip:port across all partners.
    const seen = new Set<string>();
    const uniq: CachedPeer[] = [];
    for (const p of collected) {
      const k = `${p.ip}:${p.port}`;
      if (seen.has(k)) continue;
      seen.add(k);
      uniq.push(p);
      if (uniq.length >= MAX_PER_TORRENT) break;
    }
    await redis.set(key, JSON.stringify(uniq), 'EX', CACHE_TTL_S).catch(() => {});
    totalPeers += uniq.length;
  }

  return { torrents: localTorrents.length, peers: totalPeers };
}
