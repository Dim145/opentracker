import { getGlobalStats } from '~~/utils/server';
import { db, schema } from '@trackarr/db';
import { sql } from 'drizzle-orm';
import { redis } from '~~/utils/server';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  // Require admin authentication
  await requireAdminSession(event);
  // Get total torrents from DB
  const torrentsCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.torrents);
  const totalTorrents = torrentsCountResult[0]?.count || 0;

  // Peer/seeder counts come from Redis. The SCAN+HGETALL walk
  // can be expensive on a live tracker (thousands of `peers:*`
  // keys, each an HGETALL round-trip), so we cache the rolled-up
  // counts in Redis for STATS_TTL_S. The dashboard tile ticks
  // every 30s; second-level precision isn't worth a fresh scan
  // on every poll.
  const keyPrefix = process.env.REDIS_KEY_PREFIX || 'ot:';
  const STATS_TTL_S = 30;
  const CACHE_KEY = 'stats:peers';

  let totalPeers = 0;
  let totalSeeders = 0;
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      totalPeers = parsed.peers ?? 0;
      totalSeeders = parsed.seeders ?? 0;
    } else {
      const uniquePeers = new Set<string>();
      const uniqueSeeders = new Set<string>();
      let cursor = '0';
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          `${keyPrefix}peers:*`,
          'COUNT',
          100
        );
        cursor = nextCursor;
        if (keys.length === 0) continue;
        // Pipeline the HGETALLs for this scan batch so we pay one
        // round-trip per ~100 keys instead of one per key.
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
          for (const json of Object.values(peersData as Record<string, string>)) {
            try {
              const peer = JSON.parse(json);
              const peerKey = `${peer.ip}:${peer.port}`;
              uniquePeers.add(peerKey);
              if (peer.isSeeder) uniqueSeeders.add(peerKey);
            } catch {
              /* invalid JSON — skip */
            }
          }
        }
      } while (cursor !== '0');
      totalPeers = uniquePeers.size;
      totalSeeders = uniqueSeeders.size;
      await redis.set(
        CACHE_KEY,
        JSON.stringify({ peers: totalPeers, seeders: totalSeeders }),
        'EX',
        STATS_TTL_S
      );
    }
  } catch (err) {
    console.error('[Stats] Failed to fetch peer count from Redis:', err);
  }

  // Protocol matrix mirrored from the tracker container's env. HTTP
  // is always on; UDP toggles via `TRACKER_UDP_ENABLED` (default true,
  // see apps/tracker/internal/config/config.go). The api process and
  // tracker process share the same env so this read is authoritative
  // without an internal RPC.
  return {
    status: 'running',
    cached: {
      torrents: totalTorrents,
      peers: totalPeers,
      seeders: totalSeeders,
      updatedAt: Date.now(),
    },
    live: {
      torrents: totalTorrents,
      peers: totalPeers,
    },
    protocols: {
      http: true,
      udp: process.env.TRACKER_UDP_ENABLED !== 'false',
      ws: false,
    },
  };
});
