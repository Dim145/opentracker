/**
 * Prometheus metrics — exposed on a dedicated port (see plugins/metrics.ts).
 *
 * Two cost categories:
 *   - DB COUNT() and Redis INFO are cheap (a few ms) → recomputed on every
 *     scrape so Prometheus sees fresh data with the configured scrape
 *     interval (15s by default in most setups).
 *   - Redis SCAN over `peers:*` walks every active swarm key. On a healthy
 *     tracker that's hundreds-to-thousands of keys, each requiring an
 *     HGETALL — too expensive to do per scrape. We cache the SCAN result
 *     for `METRICS_PEER_CACHE_MS` (default 30s, slightly longer than a
 *     typical scrape) so a Prometheus burst doesn't repeatedly walk the
 *     keyspace.
 */
import {
  Registry,
  Gauge,
  collectDefaultMetrics,
  type MetricObjectWithValues,
} from 'prom-client';
import { db, schema } from '@trackarr/db';
import { sql, eq, isNull, and, or, gt, ne } from 'drizzle-orm';
import { redis } from './server';

const PEER_CACHE_MS = parseInt(
  process.env.METRICS_PEER_CACHE_MS || '30000',
  10
);

export const registry = new Registry();

// Default Node.js process metrics (cpu, heap, eventloop lag, gc, etc.).
collectDefaultMetrics({ register: registry, prefix: 'trackarr_' });

// `Gauge` config takes `registers: Registry[]`; `register` (singular) is
// silently ignored, which would route every gauge to prom-client's default
// global registry instead of our custom one. Spent an embarrassing amount
// of time staring at /metrics wondering where my counts went.
const labelMeta = { registers: [registry] } as const;

// ─── Business / content ──────────────────────────────────────────────────────

const usersTotal = new Gauge({
  name: 'trackarr_users_total',
  help: 'Total registered user accounts.',
  ...labelMeta,
});

const torrentsTotal = new Gauge({
  name: 'trackarr_torrents_total',
  help: 'Total torrents indexed.',
  ...labelMeta,
});

const torrentsBytesTotal = new Gauge({
  name: 'trackarr_torrents_bytes_total',
  help: 'Sum of all torrent sizes, in bytes.',
  ...labelMeta,
});

// ─── Swarm (Redis-derived) ───────────────────────────────────────────────────

const peersTotal = new Gauge({
  name: 'trackarr_peers_total',
  help: 'Unique active peers across the swarm (by ip:port). Cached for METRICS_PEER_CACHE_MS to bound scrape cost.',
  ...labelMeta,
});

const seedersTotal = new Gauge({
  name: 'trackarr_seeders_total',
  help: 'Unique active seeders across the swarm.',
  ...labelMeta,
});

const leechersTotal = new Gauge({
  name: 'trackarr_leechers_total',
  help: 'Unique active leechers (peers that are not seeders).',
  ...labelMeta,
});

// ─── Forum / community ───────────────────────────────────────────────────────

const forumTopicsTotal = new Gauge({
  name: 'trackarr_forum_topics_total',
  help: 'Total forum topics.',
  ...labelMeta,
});

const forumPostsTotal = new Gauge({
  name: 'trackarr_forum_posts_total',
  help: 'Total forum posts (including topic openers).',
  ...labelMeta,
});

// ─── Moderation / governance ─────────────────────────────────────────────────

const reportsPendingTotal = new Gauge({
  name: 'trackarr_reports_pending_total',
  help: "Reports in 'pending' status awaiting moderator review.",
  ...labelMeta,
});

const hnrActiveTotal = new Gauge({
  name: 'trackarr_hnr_active_total',
  help: 'Active hit-and-run tracking entries (not yet satisfied or expired).',
  ...labelMeta,
});

const invitationsPendingTotal = new Gauge({
  name: 'trackarr_invitations_pending_total',
  help: 'Unused, non-expired invitation codes.',
  ...labelMeta,
});

const bannedIpsTotal = new Gauge({
  name: 'trackarr_banned_ips_total',
  help: 'Banned IPs currently in the blocklist.',
  ...labelMeta,
});

// ─── Storage ─────────────────────────────────────────────────────────────────

const redisMemoryBytes = new Gauge({
  name: 'trackarr_redis_memory_bytes',
  help: 'Redis used memory in bytes (used_memory from INFO).',
  ...labelMeta,
});

const databaseSizeBytes = new Gauge({
  name: 'trackarr_database_size_bytes',
  help: 'PostgreSQL database size in bytes (pg_database_size).',
  ...labelMeta,
});

// ─── Swarm scan cache ────────────────────────────────────────────────────────

interface SwarmCounts {
  peers: number;
  seeders: number;
  leechers: number;
  collectedAt: number;
}

let cachedSwarm: SwarmCounts | null = null;
let swarmInflight: Promise<SwarmCounts> | null = null;

async function scanSwarmCounts(): Promise<SwarmCounts> {
  const keyPrefix = process.env.REDIS_KEY_PREFIX || 'ot:';
  const SCAN_TIME_BUDGET_MS = 30_000;
  const deadline = Date.now() + SCAN_TIME_BUDGET_MS;

  const uniquePeers = new Set<string>();
  const uniqueSeeders = new Set<string>();

  let cursor = '0';
  do {
    if (Date.now() > deadline) break;
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
          // ignore malformed entries
        }
      }
    }
  } while (cursor !== '0');

  return {
    peers: uniquePeers.size,
    seeders: uniqueSeeders.size,
    leechers: uniquePeers.size - uniqueSeeders.size,
    collectedAt: Date.now(),
  };
}

async function getSwarmCounts(): Promise<SwarmCounts> {
  const fresh =
    cachedSwarm && Date.now() - cachedSwarm.collectedAt < PEER_CACHE_MS;
  if (fresh) return cachedSwarm!;
  if (swarmInflight) return swarmInflight;

  swarmInflight = (async () => {
    try {
      const counts = await scanSwarmCounts();
      cachedSwarm = counts;
      return counts;
    } catch (err) {
      console.error('[metrics] swarm scan failed:', err);
      // Fall back to last known good values rather than zeroing the gauge,
      // which would create misleading dips on Prometheus dashboards.
      return (
        cachedSwarm ?? {
          peers: 0,
          seeders: 0,
          leechers: 0,
          collectedAt: Date.now(),
        }
      );
    } finally {
      swarmInflight = null;
    }
  })();

  return swarmInflight;
}

// ─── Refresh on scrape ──────────────────────────────────────────────────────

async function refreshGauges(): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  // Cheap: parallel COUNT(*) queries. drizzle returns [{ count }] each.
  const countQuery = (table: any, where?: any) => {
    const q = db
      .select({ count: sql<number>`count(*)::int` })
      .from(table);
    return where ? q.where(where) : q;
  };

  tasks.push(
    countQuery(schema.users).then((r) => usersTotal.set(r[0]?.count ?? 0))
  );

  tasks.push(
    db
      .select({
        count: sql<number>`count(*)::int`,
        bytes: sql<string>`coalesce(sum(size), 0)::text`,
      })
      .from(schema.torrents)
      .then((r) => {
        torrentsTotal.set(r[0]?.count ?? 0);
        torrentsBytesTotal.set(Number(r[0]?.bytes ?? 0));
      })
  );

  tasks.push(
    countQuery(schema.forumTopics).then((r) =>
      forumTopicsTotal.set(r[0]?.count ?? 0)
    )
  );

  tasks.push(
    countQuery(schema.forumPosts).then((r) =>
      forumPostsTotal.set(r[0]?.count ?? 0)
    )
  );

  tasks.push(
    countQuery(schema.reports, eq(schema.reports.status, 'pending')).then(
      (r) => reportsPendingTotal.set(r[0]?.count ?? 0)
    )
  );

  // Active = still required to seed (not satisfied, not exempt). Mirrors
  // how the HnR admin tab decides who's currently on the hook.
  tasks.push(
    countQuery(
      schema.hnrTracking,
      and(
        isNull(schema.hnrTracking.completedAt),
        ne(schema.hnrTracking.isExempt, true)
      )
    )
      .then((r) => hnrActiveTotal.set(r[0]?.count ?? 0))
      .catch(() => {
        // Tolerate schema drift; leave gauge at last value.
      })
  );

  tasks.push(
    countQuery(
      schema.invitations,
      and(
        isNull(schema.invitations.usedBy),
        or(
          isNull(schema.invitations.expiresAt),
          gt(schema.invitations.expiresAt, new Date())
        )
      )
    )
      .then((r) => invitationsPendingTotal.set(r[0]?.count ?? 0))
      .catch(() => {
        // Tolerate schema drift.
      })
  );

  tasks.push(
    countQuery(schema.bannedIps).then((r) =>
      bannedIpsTotal.set(r[0]?.count ?? 0)
    )
  );

  // Postgres database size.
  tasks.push(
    db
      .execute(sql`SELECT pg_database_size(current_database())::bigint AS size`)
      .then((rows: any) => {
        const v = Number(rows?.[0]?.size ?? 0);
        databaseSizeBytes.set(Number.isFinite(v) ? v : 0);
      })
  );

  // Redis memory.
  tasks.push(
    redis.info('memory').then((info) => {
      const m = info.match(/used_memory:(\d+)/);
      redisMemoryBytes.set(m ? parseInt(m[1]!, 10) : 0);
    })
  );

  // Swarm (cached SCAN).
  tasks.push(
    getSwarmCounts().then((s) => {
      peersTotal.set(s.peers);
      seedersTotal.set(s.seeders);
      leechersTotal.set(s.leechers);
    })
  );

  // We don't want one slow / failed query to block the rest. allSettled
  // lets each gauge succeed or fail independently.
  await Promise.allSettled(tasks);
}

export async function getMetricsText(): Promise<string> {
  await refreshGauges();
  return registry.metrics();
}

export async function getMetricsContentType(): Promise<string> {
  return registry.contentType;
}

// Exported for tests / introspection.
export type { MetricObjectWithValues };
