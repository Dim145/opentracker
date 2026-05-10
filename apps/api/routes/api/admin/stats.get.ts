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

  // Get total unique peers and seeders from Redis using SCAN for safety
  // Note: ioredis with keyPrefix - SCAN returns full keys with prefix,
  // but we need to strip the prefix before passing to other commands
  // We use Sets to count unique peers by ip:port (a peer seeding multiple torrents counts as 1)
  const keyPrefix = process.env.REDIS_KEY_PREFIX || 'ot:';
  const uniquePeers = new Set<string>();
  const uniqueSeeders = new Set<string>();
  let cursor = '0';
  let scannedKeys = 0;
  try {
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${keyPrefix}peers:*`,
        'COUNT',
        100
      );
      cursor = nextCursor;
      scannedKeys += keys.length;
      for (const fullKey of keys) {
        // Strip the prefix from the key returned by SCAN to avoid double-prefixing
        const key = fullKey.startsWith(keyPrefix)
          ? fullKey.slice(keyPrefix.length)
          : fullKey;
        const peersData = await redis.hgetall(key);
        for (const json of Object.values(peersData)) {
          try {
            const peer = JSON.parse(json as string);
            // Use ip:port as unique identifier for a peer
            const peerKey = `${peer.ip}:${peer.port}`;
            uniquePeers.add(peerKey);
            if (peer.isSeeder) uniqueSeeders.add(peerKey);
          } catch (e) {
            // Ignore invalid JSON
          }
        }
      }
    } while (cursor !== '0');
  } catch (err) {
    console.error('[Stats] Failed to fetch peer count from Redis:', err);
  }

  const totalPeers = uniquePeers.size;
  const totalSeeders = uniqueSeeders.size;

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
