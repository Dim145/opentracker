/**
 * Debug endpoint to check tracker status and configuration
 * Usage: GET /api/admin/debug/tracker-status
 */
import { redis } from '~~/utils/server';
import { getGlobalStats } from '~~/utils/server';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  // Admin only — live-role-revalidating gate (finding L9).
  await requireAdminSession(event);

  // Check Redis connection
  let redisStatus = 'unknown';
  let redisPing = '';
  try {
    redisPing = await redis.ping();
    redisStatus = redisPing === 'PONG' ? 'connected' : 'error';
  } catch (err) {
    redisStatus = 'disconnected';
    redisPing = (err as Error).message;
  }

  // The tracker is in a separate container, so we can't introspect its
  // process state from here. Report the static protocol matrix and let the
  // operator check `docker compose ps tracker` for liveness.
  const trackerStatus = 'separate-process';
  const trackerProtocols = { http: true, udp: false, ws: false };

  // Get global stats from cache
  let globalStats = null;
  try {
    globalStats = await getGlobalStats();
  } catch (err) {
    globalStats = { error: (err as Error).message };
  }

  // Count peer keys manually
  const keyPrefix = process.env.REDIS_KEY_PREFIX || 'ot:';
  let peerKeyCount = 0;
  let totalPeersInRedis = 0;
  try {
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
        peerKeyCount++;
        const key = fullKey.startsWith(keyPrefix)
          ? fullKey.slice(keyPrefix.length)
          : fullKey;
        const count = await redis.hlen(key);
        totalPeersInRedis += count;
      }
    } while (cursor !== '0');
  } catch (err) {
    peerKeyCount = -1;
  }

  return {
    timestamp: new Date().toISOString(),
    redis: {
      status: redisStatus,
      ping: redisPing,
      keyPrefix,
    },
    tracker: {
      status: trackerStatus,
      protocols: trackerProtocols,
      httpUrl: useRuntimeConfig().public.trackerHttpUrl as string,
    },
    peers: {
      keyCount: peerKeyCount,
      totalPeers: totalPeersInRedis,
    },
    cachedGlobalStats: globalStats,
    env: {
      nodeEnv: process.env.NODE_ENV,
      hasIpHashSecret: !!process.env.IP_HASH_SECRET,
      redisHost: process.env.REDIS_HOST || 'not set',
      redisPort: process.env.REDIS_PORT || 'not set',
    },
  };
});
