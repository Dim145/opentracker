/**
 * Shared "live swarm" rollup used by the four places that surface
 * peer/seeder counters to the UI and Prometheus:
 *
 *   - `routes/api/admin/stats.get.ts`      (admin dashboard tile)
 *   - `routes/api/admin/stats/history.get.ts` (history snapshots)
 *   - `routes/api/stats/public.get.ts`     (homepage + protocol health)
 *   - `utils/metrics.ts`                   (Prometheus gauges)
 *
 * The dedup key is `(ip, port)` — one network endpoint = one peer.
 * Two machines behind the same NAT but on different ports still
 * register as two, which matches what a "swarm peer" means in
 * BitTorrent semantics. Multiple sessions of the same client (new
 * peer_id) on the same listening port collapse to one, which is
 * what an operator typically expects.
 *
 * A peer is considered **active** when its last announce landed
 * within `ACTIVE_WINDOW_MS` of `now`. Anything older is kept in
 * Redis (the tracker still needs it for the delta computation in
 * `apps/tracker/internal/server/handler.go`) but excluded from the
 * count. Without this filter, the long peer TTL (`TRACKER_PEER_TTL`,
 * 24 h by default) silently inflates the "active swarm" tiles with
 * every restart and every torrent that touched a different
 * peer_id/port between sessions.
 */
import { redis } from './server';

/**
 * Two announce intervals (2 × 30 min). Anything older than this has
 * either missed an announce window or been stopped — in both cases
 * it doesn't belong in a "currently active" count. Kept as a single
 * constant rather than env-driven; if the tracker's `announceInterval`
 * ever becomes configurable we should derive this from it.
 */
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

export interface ActivePeerCounts {
  peers: number;
  seeders: number;
  leechers: number;
}

export interface RollupOptions {
  /** Override the active window (ms). Defaults to `ACTIVE_WINDOW_MS`. */
  activeWindowMs?: number;
  /**
   * Soft deadline. When `Date.now()` crosses this point the scan
   * returns whatever it has so far. Used by the Prometheus metrics
   * path so a runaway swarm can't stall the scrape.
   */
  deadline?: number;
}

/**
 * Walks every `peers:*` hash in Redis once, filters out entries that
 * haven't re-announced within the active window, dedupes the rest by
 * `(ip, port)`, and returns the totals.
 */
export async function rollupActivePeerCounts(
  options: RollupOptions = {}
): Promise<ActivePeerCounts> {
  const activeWindowMs = options.activeWindowMs ?? ACTIVE_WINDOW_MS;
  const deadline = options.deadline;
  const cutoff = Date.now() - activeWindowMs;

  const keyPrefix = process.env.REDIS_KEY_PREFIX || 'ot:';
  const uniquePeers = new Set<string>();
  // Seeder and leecher sets are populated independently — a single
  // machine can be seeding one torrent AND leeching another at the
  // same time, in which case its `(ip, port)` lands in BOTH sets.
  // Computing `leechers = peers - seeders` (the previous behaviour)
  // would hide that machine from the leecher tile entirely, even
  // though it's actively downloading. The two counters can now
  // overlap, so `seeders + leechers` may exceed `peers`; that's the
  // honest representation of a mixed swarm.
  const uniqueSeeders = new Set<string>();
  const uniqueLeechers = new Set<string>();

  let cursor = '0';
  try {
    do {
      if (deadline !== undefined && Date.now() > deadline) break;
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${keyPrefix}peers:*`,
        'COUNT',
        100
      );
      cursor = nextCursor;
      if (keys.length === 0) continue;

      const pipeline = redis.pipeline();
      const localKeys = keys.map((fullKey) =>
        fullKey.startsWith(keyPrefix)
          ? fullKey.slice(keyPrefix.length)
          : fullKey
      );
      for (const key of localKeys) pipeline.hgetall(key);
      const results = await pipeline.exec();
      if (!results) continue;

      for (const [err, peersData] of results) {
        if (err) continue;
        for (const json of Object.values(
          peersData as Record<string, string>
        )) {
          try {
            const peer = JSON.parse(json);
            // Skip stale entries — peer hasn't re-announced recently
            // enough to count as currently active.
            if (
              typeof peer.updatedAt === 'number' &&
              peer.updatedAt < cutoff
            ) {
              continue;
            }
            const peerKey = `${peer.ip}:${peer.port}`;
            uniquePeers.add(peerKey);
            if (peer.isSeeder) {
              uniqueSeeders.add(peerKey);
            } else {
              uniqueLeechers.add(peerKey);
            }
          } catch {
            // ignore malformed peer payload
          }
        }
      }
    } while (cursor !== '0');
  } catch (err) {
    console.warn(
      '[peerStats] Redis scan failed:',
      (err as Error).message
    );
  }

  return {
    peers: uniquePeers.size,
    seeders: uniqueSeeders.size,
    leechers: uniqueLeechers.size,
  };
}
