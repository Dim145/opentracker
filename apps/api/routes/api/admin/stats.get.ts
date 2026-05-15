import { getGlobalStats } from '~~/utils/server';
import { db, schema } from '@trackarr/db';
import { sql } from 'drizzle-orm';
import { redis } from '~~/utils/server';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rollupActivePeerCounts } from '~~/utils/peerStats';

export default defineEventHandler(async (event) => {
  // Require admin authentication
  await requireAdminSession(event);
  // Get total torrents from DB
  const torrentsCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.torrents);
  const totalTorrents = torrentsCountResult[0]?.count || 0;

  // Peer/seeder counts come from Redis through the shared rollup
  // helper (active-window filtered, dedup by `ip:port`). The
  // SCAN+HGETALL walk is expensive on a live tracker so we cache
  // the rolled-up counts in Redis for STATS_TTL_S — the dashboard
  // tile ticks every 30s; second-level precision isn't worth a
  // fresh scan on every poll.
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
      const counts = await rollupActivePeerCounts();
      totalPeers = counts.peers;
      totalSeeders = counts.seeders;
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
