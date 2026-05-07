import { db, schema } from '@trackarr/db';
import { sql } from 'drizzle-orm';
import { redis } from '~~/utils/server';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

/**
 * GET /api/stats/public
 *
 * Anonymous-safe counters for the homepage hero (total torrents / unique peers /
 * unique seeders). Mirrors the shape of /api/admin/stats so the existing home
 * page can swap one URL for the other without restructuring its template.
 *
 * Rationale: the home page used to call /api/admin/stats which is gated behind
 * `requireAdminSession`. For any non-admin visitor the call returned 401, the
 * page rendered "0 torrents · 0 peers", and casual visitors saw a tracker that
 * looked dead. We expose only aggregate counts here — no protocol matrix, no
 * per-torrent / per-user data.
 *
 * Cached at the response level via a short module-scope TTL because the
 * underlying Redis SCAN can iterate thousands of peer keys on a busy swarm.
 */

interface PublicStats {
  cached: {
    torrents: number;
    peers: number;
    seeders: number;
    updatedAt: number;
  };
  live: {
    torrents: number;
    peers: number;
  };
}

const CACHE_TTL_MS = 15_000;
let cached: { value: PublicStats; expiresAt: number } | null = null;

async function computeStats(): Promise<PublicStats> {
  const torrentsCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.torrents);
  const totalTorrents = torrentsCountResult[0]?.count || 0;

  const keyPrefix = process.env.REDIS_KEY_PREFIX || 'ot:';
  const uniquePeers = new Set<string>();
  const uniqueSeeders = new Set<string>();
  let cursor = '0';

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
      for (const fullKey of keys) {
        const key = fullKey.startsWith(keyPrefix)
          ? fullKey.slice(keyPrefix.length)
          : fullKey;
        const peersData = await redis.hgetall(key);
        for (const json of Object.values(peersData)) {
          try {
            const peer = JSON.parse(json as string);
            const peerKey = `${peer.ip}:${peer.port}`;
            uniquePeers.add(peerKey);
            if (peer.isSeeder) uniqueSeeders.add(peerKey);
          } catch {
            // Ignore malformed peer payload
          }
        }
      }
    } while (cursor !== '0');
  } catch (err) {
    console.warn('[Stats/public] Redis scan failed:', (err as Error).message);
  }

  const now = Date.now();
  return {
    cached: {
      torrents: totalTorrents,
      peers: uniquePeers.size,
      seeders: uniqueSeeders.size,
      updatedAt: now,
    },
    live: {
      torrents: totalTorrents,
      peers: uniquePeers.size,
    },
  };
}

export default defineEventHandler(async (event) => {
  // Public endpoint, but rate-limited like other public reads to keep the
  // SCAN-driven Redis load bounded if a bot decides to refresh aggressively.
  await rateLimit(event, RATE_LIMITS.public);

  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const value = await computeStats();
  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
});
