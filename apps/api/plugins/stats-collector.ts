import { db, schema } from '@trackarr/db';
import { sql } from 'drizzle-orm';
import { redis } from '~~/utils/server';
import { v4 as uuidv4 } from 'uuid';
import { withCronLock } from '~~/utils/cronLock';

/**
 * Persist the per-swarm tally into `torrent_stats`.
 *
 * The table is the only Postgres-side view of the swarm: Redis holds the live
 * peers, but a query that needs counts for many torrents at once — the grouped
 * catalogue's seeder range, the federation catalogue feeds — cannot fan out one
 * Redis read per row. It reads this snapshot instead, and pays for that with
 * staleness bounded by the collection interval.
 *
 * **A torrent whose swarm emptied has no Redis key at all**, so it is not in
 * the tally and would otherwise keep its last non-zero count forever. Rows not
 * observed are therefore reset — but only after a COMPLETE scan. A scan cut
 * short by the time budget saw an arbitrary subset, and zeroing everything it
 * missed would report a healthy catalogue as dead.
 */
async function writeTorrentStats(
  perTorrent: Map<string, { seeders: number; leechers: number }>,
  scanTruncated: boolean
): Promise<void> {
  // Taken before the first write, so every row this pass touches ends up with
  // a later `updated_at` than this. That is how the sweep below recognises
  // what it did NOT see, without carrying a list of a hundred thousand hashes
  // into a query.
  const passStartedAt = new Date().toISOString();
  try {
    if (perTorrent.size > 0) {
      // Chunked so the statement stays well inside Postgres' parameter limit
      // on a catalogue with a six-figure number of live swarms.
      const CHUNK = 1_000;
      const entries = [...perTorrent.entries()];
      for (let i = 0; i < entries.length; i += CHUNK) {
        const slice = entries.slice(i, i + CHUNK);
        const values = sql.join(
          slice.map(
            ([hash, c]) => sql`(${hash}, ${c.seeders}::int, ${c.leechers}::int)`
          ),
          sql`, `
        );
        // Insert, not update: the row is created at upload, but a torrent
        // that arrived any other way — a federation mirror, a restore — has
        // none, and an UPDATE would drop its counts on the floor for good.
        //
        // `completed` is deliberately untouched: a snapshot cannot see it —
        // it is a cumulative counter, not a fact about the current swarm.
        await db.execute(sql`
          INSERT INTO torrent_stats (info_hash, seeders, leechers, updated_at)
          SELECT v.info_hash, v.seeders, v.leechers, now()
            FROM (VALUES ${values}) AS v(info_hash, seeders, leechers)
           WHERE EXISTS (SELECT 1 FROM torrents t WHERE t.info_hash = v.info_hash)
              ON CONFLICT (info_hash) DO UPDATE
             SET seeders = excluded.seeders,
                 leechers = excluded.leechers,
                 updated_at = excluded.updated_at
        `);
      }
    }

    if (!scanTruncated) {
      // Anything still carrying a count from before this pass has no swarm
      // left. The predicate excludes rows already at zero, so a quiet
      // catalogue costs one indexless-but-cheap pass and writes nothing.
      await db.execute(sql`
        UPDATE torrent_stats
           SET seeders = 0, leechers = 0, updated_at = now()
         WHERE (seeders <> 0 OR leechers <> 0)
           AND updated_at < ${passStartedAt}::timestamptz`);
    }
  } catch (err) {
    // A stale snapshot degrades a range on a collapsed row; it must never
    // take the rest of the collection down with it.
    console.warn(
      '[Stats Collector] torrent_stats refresh failed:',
      (err as Error).message
    );
  }
}

export default defineNitroPlugin((nitroApp) => {
  // Run every hour by default, or use env var (in ms)
  const INTERVAL = parseInt(
    process.env.STATS_COLLECTION_INTERVAL || '3600000',
    10
  );

  console.log(`[Stats Collector] Initialized with interval: ${INTERVAL}ms`);

  const collectStats = async () => {
    console.log('[Stats Collector] Starting stats collection...');
    try {
      // 1. Users Count
      const usersCountResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.users);
      const usersCount = usersCountResult[0]?.count || 0;

      // 2. Torrents Count
      const torrentsCountResult = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.torrents);
      const torrentsCount = torrentsCountResult[0]?.count || 0;

      // 3. Peers & Seeders Count (from Redis) - count unique peers by ip:port
      // Note: ioredis with keyPrefix - SCAN returns full keys with prefix,
      // but we need to strip the prefix before passing to other commands
      // Bounded by SCAN_TIME_BUDGET_MS so a swarm of 100k+ peers can't block
      // the event loop indefinitely. We just emit partial stats if exceeded.
      const SCAN_TIME_BUDGET_MS = 30_000;
      const scanDeadline = Date.now() + SCAN_TIME_BUDGET_MS;
      let scanTruncated = false;

      const keyPrefix = process.env.REDIS_KEY_PREFIX || 'ot:';
      const uniquePeers = new Set<string>();
      const uniqueSeeders = new Set<string>();
      // Per-torrent tally, taken from the same pass. `torrent_stats` used to
      // be written once at upload and never again, so every consumer of it —
      // the three federation feeds — was publishing zeroes. The peers are
      // already parsed here; counting them per swarm costs one map entry.
      const perTorrent = new Map<string, { seeders: number; leechers: number }>();
      let cursor = '0';
      do {
        if (Date.now() > scanDeadline) {
          scanTruncated = true;
          break;
        }
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          `${keyPrefix}peers:*`,
          'COUNT',
          100
        );
        cursor = nextCursor;
        for (const fullKey of keys) {
          // Strip the prefix from the key returned by SCAN to avoid double-prefixing
          const key = fullKey.startsWith(keyPrefix)
            ? fullKey.slice(keyPrefix.length)
            : fullKey;
          const peersData = await redis.hgetall(key);
          const infoHash = key.slice('peers:'.length);
          let seeders = 0;
          let leechers = 0;
          for (const json of Object.values(peersData)) {
            try {
              const peer = JSON.parse(json as string);
              const peerKey = `${peer.ip}:${peer.port}`;
              uniquePeers.add(peerKey);
              if (peer.isSeeder) {
                uniqueSeeders.add(peerKey);
                seeders++;
              } else {
                leechers++;
              }
            } catch (e) {}
          }
          if (infoHash) perTorrent.set(infoHash, { seeders, leechers });
        }
      } while (cursor !== '0');
      const peersCount = uniquePeers.size;
      const seedersCount = uniqueSeeders.size;
      if (scanTruncated) {
        console.warn(
          `[Stats Collector] SCAN exceeded ${SCAN_TIME_BUDGET_MS}ms — counts are partial`
        );
      }

      await writeTorrentStats(perTorrent, scanTruncated);

      // 4. Redis Memory Usage
      const info = await redis.info('memory');
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const redisMemoryUsage = memoryMatch ? parseInt(memoryMatch[1], 10) : 0;

      // 5. DB Size
      const dbSizeResult = await db.execute(
        sql`SELECT pg_database_size(current_database())::bigint`
      );
      const dbSize = Number(dbSizeResult[0]?.pg_database_size) || 0;

      // 6. Cumulative traffic — bytes that *actually transited* the
      //    swarm, i.e. came from announce deltas. `users.uploaded`
      //    also accumulates shop `upload_credit` purchases and the
      //    starter upload bonus credited at registration, so we
      //    subtract `bonus_uploaded` (the column that tracks exactly
      //    those non-traffic credits) to keep the public KPI honest.
      const uploadedSumResult = await db
        .select({
          total: sql<string>`COALESCE(SUM(${schema.users.uploaded} - ${schema.users.bonusUploaded}), 0)::text`,
        })
        .from(schema.users);
      const totalUploadedBytes = Number(uploadedSumResult[0]?.total ?? '0');

      // Save to DB
      await db.insert(schema.siteStats).values({
        id: uuidv4(),
        usersCount,
        torrentsCount,
        peersCount,
        seedersCount,
        redisMemoryUsage,
        dbSize,
        totalUploadedBytes,
        createdAt: new Date(),
      });

      console.log(
        `[Stats Collector] Stats collected successfully. Peers: ${peersCount}, Seeders: ${seedersCount}, Uploaded: ${totalUploadedBytes}`
      );
    } catch (err) {
      console.error('[Stats Collector] Failed to collect stats:', err);
    }
  };

  // Cross-replica lock so a multi-replica deployment writes ONE site_stats
  // snapshot per tick, not N (finding L20). Single-replica setups are
  // unaffected (the lock is always free).
  const tick = () =>
    void withCronLock('stats_collector:lock', 5 * 60, collectStats);

  // Initial collection after a short delay to ensure DB/Redis are ready.
  // unref both timers so they don't pin the event loop during shutdown.
  setTimeout(tick, 10000).unref?.();

  // Schedule periodic collection
  setInterval(tick, INTERVAL).unref?.();
});
