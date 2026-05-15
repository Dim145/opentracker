import { db, schema } from '@trackarr/db';
import { desc, asc, gte, sql } from 'drizzle-orm';
import { requireAdminSession } from '~~/utils/adminAuth';
import { redis } from '~~/utils/server';
import { rollupActivePeerCounts } from '~~/utils/peerStats';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const query = getQuery(event);
  const days = parseInt(query.days as string) || 7;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // 1. Get historical stats
  const history = await db
    .select()
    .from(schema.siteStats)
    .where(gte(schema.siteStats.createdAt, startDate))
    .orderBy(asc(schema.siteStats.createdAt));

  // 2. keyPrefix (should match stats-collector)
  const keyPrefix = process.env.REDIS_KEY_PREFIX || 'ot:';

  // 3. Get CURRENT live stats to append as the latest data point
  // This ensures the charts show real-time state even if collector hasn't run recently
  try {
    // Users
    const usersCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.users);
    const usersCount = usersCountResult[0]?.count || 0;

    // Torrents
    const torrentsCountResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.torrents);
    const torrentsCount = torrentsCountResult[0]?.count || 0;

    // Redis Memory
    const info = await redis.info('memory');
    const memoryMatch = info.match(/used_memory:(\d+)/);
    const redisMemoryUsage = memoryMatch ? parseInt(memoryMatch[1], 10) : 0;

    // DB Size
    const dbSizeResult = await db.execute(
      sql`SELECT pg_database_size(current_database())::bigint`
    );
    const dbSize = Number(dbSizeResult[0]?.pg_database_size) || 0;

    // Peers & Seeders — shared rollup, dedup by `(ip, port)`, filtered
    // to peers that re-announced within the active window so the live
    // data point isn't inflated by stale entries from the 24 h peer TTL.
    const counts = await rollupActivePeerCounts();
    const peersCount = counts.peers;
    const seedersCount = counts.seeders;

    // Always append a 'live' data point to show current real-time stats
    // This ensures the chart always reflects the current state
    const livePoint = {
      id: 'live',
      usersCount,
      torrentsCount,
      peersCount,
      seedersCount,
      redisMemoryUsage,
      dbSize,
      createdAt: new Date(),
    } as any;

    // If the last historical point is very recent (< 1 min), replace
    // it with live data; otherwise append as a new point. `.at(-1)`
    // (ES2022) is the read; the assignment still uses an explicit
    // index since `.at()` returns a value, not an l-value.
    const lastPoint = history.at(-1);
    const now = Date.now();
    const oneMinute = 60 * 1000;

    if (
      lastPoint &&
      now - new Date(lastPoint.createdAt).getTime() < oneMinute
    ) {
      // Replace the last point with live data
      history[history.length - 1] = {
        ...lastPoint,
        ...livePoint,
        id: lastPoint.id,
      };
    } else {
      history.push(livePoint);
    }
  } catch (err) {
    console.error('[Stats History] Failed to fetch live stats:', err);
  }

  return history;
});
