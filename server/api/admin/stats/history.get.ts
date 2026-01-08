import { db, schema } from '../../../db';
import { desc, asc, gte, sql } from 'drizzle-orm';
import { requireAdminSession } from '../../../utils/adminAuth';
import { redis } from '../../../redis/client';

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

    // Peers & Seeders (SCAN)
    let peersCount = 0;
    let seedersCount = 0;
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
      for (const fullKey of keys) {
        const key = fullKey.startsWith(keyPrefix)
          ? fullKey.slice(keyPrefix.length)
          : fullKey;
        const peersData = await redis.hgetall(key);
        for (const json of Object.values(peersData)) {
          try {
            const peer = JSON.parse(json as string);
            peersCount++;
            if (peer.isSeeder) seedersCount++;
          } catch (e) {}
        }
      }
    } while (cursor !== '0');

    // Append 'live' data point
    // Check if we should append: only if history is empty OR last point is older than 5 mins
    const lastPoint = history[history.length - 1];
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (
      !lastPoint ||
      now - new Date(lastPoint.createdAt).getTime() > fiveMinutes
    ) {
      history.push({
        id: 'live',
        usersCount,
        torrentsCount,
        peersCount,
        seedersCount,
        redisMemoryUsage,
        dbSize,
        createdAt: new Date(),
      } as any);
    }
  } catch (err) {
    console.error('[Stats History] Failed to fetch live stats:', err);
  }

  return history;
});
