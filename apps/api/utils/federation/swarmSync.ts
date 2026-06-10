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
import { isBlockedIp } from '../safeFetch';

const CACHE_TTL_S = 900; // 15 min — refreshed each sync tick
const MAX_PER_TORRENT = 300;
// Cap entries pointing at the same destination IP. A partner-supplied
// peer list is untrusted relay data: without a per-IP bound one partner
// could fill all 300 slots with a single victim IP across a port range,
// amplifying our whole userbase against it (finding L6).
const MAX_PORTS_PER_IP = 2;
// Lowest port we'll relay. Real BitTorrent peers never bind <1024 (needs
// root); listing :22/:25/:80/:443 etc. would just be a reflection target.
const MIN_PEER_PORT = 1024;

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
    // Query every swarm peer for this torrent in parallel — the previous
    // serial loop could stack per-peer 8s timeouts past the cron lock TTL.
    const settled = await Promise.allSettled(
      peers.map((peer) =>
        signedGet({
          baseUrl: peer.baseUrl,
          pathname: `/api/federation/peers?infoHash=${t.infoHash}`,
          instanceId,
          privateKeyPem: pk,
          timeoutMs: 8000,
        }),
      ),
    );

    const collected: CachedPeer[] = [];
    let anyOk = false; // did at least one peer actually respond 200?
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      const res = s.value;
      if (res.status === 200 && Array.isArray(res.data?.peers)) {
        anyOk = true;
        for (const rp of res.data.peers as unknown[]) {
          const o = rp as Record<string, unknown>;
          const ip = typeof o.ip === 'string' ? o.ip : '';
          const port = typeof o.port === 'number' ? o.port : 0;
          // Drop service ports (<1024) — see MIN_PEER_PORT (finding L6).
          if (!ip || port < MIN_PEER_PORT || port > 65535) continue;
          // Don't relay internal / private / loopback IPs into our swarm.
          if (isBlockedIp(ip)) continue;
          collected.push({
            peerId: '',
            ip,
            port,
            isSeeder: !!o.isSeeder,
            updatedAt: nowMs,
          });
        }
      }
    }

    const key = `remote_peers:${t.infoHash}`;
    if (!collected.length) {
      // Only clear the cache when a peer genuinely returned an empty swarm.
      // A total failure (every peer errored/timed out) must ride the existing
      // TTL rather than dropping a still-valid cross-announce set.
      if (anyOk) await redis.del(key).catch(() => {});
      continue;
    }
    // Dedup by ip:port across all partners, and cap how many entries any
    // single destination IP may contribute (finding L6).
    const seen = new Set<string>();
    const ipCounts = new Map<string, number>();
    const uniq: CachedPeer[] = [];
    for (const p of collected) {
      const k = `${p.ip}:${p.port}`;
      if (seen.has(k)) continue;
      const ipCount = ipCounts.get(p.ip) ?? 0;
      if (ipCount >= MAX_PORTS_PER_IP) continue;
      seen.add(k);
      ipCounts.set(p.ip, ipCount + 1);
      uniq.push(p);
      if (uniq.length >= MAX_PER_TORRENT) break;
    }
    await redis.set(key, JSON.stringify(uniq), 'EX', CACHE_TTL_S).catch(() => {});
    totalPeers += uniq.length;
  }

  return { torrents: localTorrents.length, peers: totalPeers };
}
