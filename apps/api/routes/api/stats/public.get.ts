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
 * looked dead. We expose aggregate counts and the protocol matrix here — no
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
    /**
     * Total bytes seeded across the whole user base — `SUM(users.uploaded)`.
     * Surfaces on the homepage as the "Volume" KPI; cached the same as the
     * other counters so a busy swarm doesn't slam Postgres on every refresh.
     * Sent as a string so JSON/JS doesn't lose precision past
     * `Number.MAX_SAFE_INTEGER` (~9 PiB).
     */
    totalUploaded: string;
    updatedAt: number;
  };
  live: {
    torrents: number;
    peers: number;
  };
  /**
   * Static protocol matrix mirrored from /api/admin/stats. The Go tracker
   * only implements HTTP — UDP and WebSocket are not built in. We expose
   * the same shape on the public endpoint so the homepage can render the
   * "Protocol health" tile without needing admin credentials.
   */
  protocols: {
    http: boolean;
    udp: boolean;
    ws: boolean;
  };
}

const CACHE_TTL_MS = 15_000;
let cached: { value: PublicStats; expiresAt: number } | null = null;

async function computeStats(): Promise<PublicStats> {
  const torrentsCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.torrents);
  const totalTorrents = torrentsCountResult[0]?.count || 0;

  // Total seeded volume — sum of every user's `uploaded` counter. We pull
  // it as a string straight from Postgres because the value can outgrow
  // `Number.MAX_SAFE_INTEGER` on a long-running tracker (≈9 PiB), and a
  // silent precision loss would make the KPI quietly wrong as soon as the
  // site crosses that threshold. The frontend parses it with `BigInt`
  // when it needs arithmetic; for display we round to the nearest unit.
  const totalUploadedResult = await db
    .select({
      total: sql<string>`COALESCE(SUM(${schema.users.uploaded}), 0)::text`,
    })
    .from(schema.users);
  const totalUploaded = totalUploadedResult[0]?.total ?? '0';

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
      totalUploaded,
      updatedAt: now,
    },
    live: {
      torrents: totalTorrents,
      peers: uniquePeers.size,
    },
    // Mirror the admin matrix. The tracker container exposes HTTP only;
    // surface that truth so the homepage's protocol-health tile reflects
    // reality instead of optimistically painting all three green.
    protocols: { http: true, udp: false, ws: false },
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
