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
import { and, asc, eq, sql } from 'drizzle-orm';
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
/** Torrents processed per tick, so one tick cannot outrun the cron lock. */
const MAX_TORRENTS_PER_TICK = 500;
/** How many torrents' peer fan-outs run at once. */
const OUTER_CONCURRENCY = 8;
/** Redis key holding the rolling window offset across ticks. */
const SWARM_OFFSET_KEY = 'federation:swarm:offset';
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
  // Narrowed once here so the closure below sees `string`, not `string | null`.
  const privateKeyPem: string = pk;

  // A rolling window, not the whole set. The per-torrent fan-out is parallel
  // across peers, but the loop over torrents was serial and unbounded: at ten
  // thousand opted-in torrents with slow or dead partners it could run for
  // hours — far past the cron lock's TTL, so a second tick would start on top
  // of it. Each tick now processes at most `MAX_TORRENTS_PER_TICK`, advancing a
  // rolling offset so the whole set is still covered over several ticks, and
  // runs the window with a bounded concurrency so it never opens more sockets
  // than the pool can hold.
  const total = (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.torrents)
      .where(
        and(
          eq(schema.torrents.federateSwarm, true),
          eq(schema.torrents.moderationStatus, 'accepted'),
          eq(schema.torrents.isActive, true),
        ),
      )
  )[0]!.n;
  if (!total) return { torrents: 0, peers: 0 };

  const rawOffset = Number((await redis.get(SWARM_OFFSET_KEY).catch(() => null)) ?? 0);
  const offset = Number.isFinite(rawOffset) && rawOffset < total ? rawOffset : 0;

  const localTorrents = await db
    .select({ infoHash: schema.torrents.infoHash })
    .from(schema.torrents)
    .where(
      and(
        eq(schema.torrents.federateSwarm, true),
        eq(schema.torrents.moderationStatus, 'accepted'),
        eq(schema.torrents.isActive, true),
      ),
    )
    .orderBy(asc(schema.torrents.infoHash))
    .limit(MAX_TORRENTS_PER_TICK)
    .offset(offset);
  if (!localTorrents.length) {
    await redis.set(SWARM_OFFSET_KEY, '0').catch(() => {});
    return { torrents: 0, peers: 0 };
  }
  // Advance (and wrap) the window for next tick.
  const nextOffset = offset + localTorrents.length;
  await redis
    .set(SWARM_OFFSET_KEY, String(nextOffset >= total ? 0 : nextOffset))
    .catch(() => {});

  const peers = (
    await db
      .select()
      .from(schema.federationPeers)
      .where(eq(schema.federationPeers.status, 'active'))
  ).filter((p) => p.acceptsFromThem?.swarm);
  if (!peers.length) return { torrents: localTorrents.length, peers: 0 };

  const nowMs = Date.now();

  /** One torrent's whole fan-out and cache write. Returns peers cached. */
  async function processTorrent(infoHash: string): Promise<number> {
    // Query every swarm peer for this torrent in parallel.
    const settled = await Promise.allSettled(
      peers.map((peer) =>
        signedGet({
          baseUrl: peer.baseUrl,
          pathname: `/api/federation/peers?infoHash=${infoHash}`,
          instanceId,
          privateKeyPem,
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
          collected.push({ peerId: '', ip, port, isSeeder: !!o.isSeeder, updatedAt: nowMs });
        }
      }
    }

    const key = `remote_peers:${infoHash}`;
    if (!collected.length) {
      // Only clear the cache when a peer genuinely returned an empty swarm.
      // A total failure (every peer errored/timed out) must ride the existing
      // TTL rather than dropping a still-valid cross-announce set.
      if (anyOk) await redis.del(key).catch(() => {});
      return 0;
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
    return uniq.length;
  }

  // Bounded concurrency over the window: a shared cursor hands each of
  // `OUTER_CONCURRENCY` workers the next torrent as it finishes, so at most
  // that many fan-outs are ever in flight regardless of how slow a partner is.
  let totalPeers = 0;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= localTorrents.length) return;
      totalPeers += await processTorrent(localTorrents[i]!.infoHash);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(OUTER_CONCURRENCY, localTorrents.length) }, worker),
  );

  return { torrents: localTorrents.length, peers: totalPeers };
}
