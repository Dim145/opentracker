/**
 * Torznab API Statistics and Logging
 * Tracks API usage, logs requests, and manages user-specific stats
 *
 * Privacy: never persist a raw passkey. The passkey is the tracker's
 * announce credential — storing it in Redis would let any operator
 * with read access (or a future log-leak bug) impersonate users on
 * the swarm. We index logs/stats/blocks by `sha256(passkey)` truncated
 * to 16 hex chars, and the persisted JSON only carries a short
 * fingerprint (`passkeyMasked`) for display.
 */

import { createHash } from 'node:crypto';
import { redis } from '~~/utils/server';

// Redis key prefixes
const KEYS = {
  STATS: 'torznab:stats',
  LOGS: 'torznab:logs',
  USER_STATS: 'torznab:user:stats',
  USER_LOGS: 'torznab:user:logs',
  BLOCKED: 'torznab:blocked',
  HOURLY: 'torznab:hourly',
  RATE_LIMIT_HITS: 'torznab:rate_limit_hits',
};

/**
 * Stable, irreversible per-passkey identifier used as the Redis index.
 * 16 hex chars = 64 bits — collision space well above realistic user
 * counts. Truncated to keep keys small in the hot path.
 */
function passkeyId(passkey: string): string {
  return createHash('sha256').update(passkey).digest('hex').slice(0, 16);
}

/**
 * Short visual fingerprint, safe to render in the admin UI:
 *   `f4a2…d09c` for a 32-char passkey.
 */
function passkeyMask(passkey: string): string {
  if (passkey.length <= 8) return '••••';
  return `${passkey.slice(0, 4)}…${passkey.slice(-4)}`;
}

// Stats TTL (30 days)
const STATS_TTL = 30 * 24 * 60 * 60;
// Logs TTL (7 days)
const LOGS_TTL = 7 * 24 * 60 * 60;

/**
 * Inputs the route handlers pass in. The `passkey` is consumed only
 * locally inside this module — derived to an id + mask before storage.
 */
interface TorznabLogInput {
  timestamp: number;
  passkey: string;
  function: string;
  query?: string;
  ip: string;
  userAgent?: string;
  responseTime: number;
  resultCount: number;
  error?: string;
}

/**
 * Persisted shape — passkey stripped, replaced by a fingerprint that
 * the admin UI can show without leaking the credential.
 */
interface TorznabLogEntry {
  timestamp: number;
  passkeyMasked: string;
  function: string;
  query?: string;
  ip: string;
  userAgent?: string;
  responseTime: number;
  resultCount: number;
  error?: string;
}

interface TorznabUserStats {
  totalRequests: number;
  searchRequests: number;
  downloadRequests: number;
  lastRequest: number;
  rateLimitHits: number;
}

interface TorznabStats {
  totalRequests: number;
  searchRequests: number;
  downloadRequests: number;
  capsRequests: number;
  tvSearchRequests: number;
  movieSearchRequests: number;
  errorsCount: number;
  uniqueUsers: number;
  avgResponseTime: number;
  last24hRequests: number;
}

// ============================================================================
// Global Stats
// ============================================================================

/**
 * Increment a stat counter
 */
async function incrementStat(field: string, amount = 1): Promise<void> {
  try {
    await redis.hincrby(KEYS.STATS, field, amount);
    await redis.expire(KEYS.STATS, STATS_TTL);
  } catch (error) {
    console.error('[Torznab Stats] Failed to increment stat:', error);
  }
}

/**
 * Get all Torznab stats
 */
export async function getTorznabStats(): Promise<TorznabStats> {
  try {
    const data = await redis.hgetall(KEYS.STATS);

    // Get unique users count from user stats hash
    const userKeys = await redis.hkeys(KEYS.USER_STATS);

    // Get last 24h requests
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    let last24hRequests = 0;

    for (let i = 0; i < 24; i++) {
      const hourKey = `${KEYS.HOURLY}:${Math.floor((now - i * 60 * 60 * 1000) / (60 * 60 * 1000))}`;
      const count = await redis.get(hourKey);
      if (count) {
        last24hRequests += parseInt(count, 10);
      }
    }

    return {
      totalRequests: parseInt(data.totalRequests || '0', 10),
      searchRequests: parseInt(data.searchRequests || '0', 10),
      downloadRequests: parseInt(data.downloadRequests || '0', 10),
      capsRequests: parseInt(data.capsRequests || '0', 10),
      tvSearchRequests: parseInt(data.tvSearchRequests || '0', 10),
      movieSearchRequests: parseInt(data.movieSearchRequests || '0', 10),
      errorsCount: parseInt(data.errorsCount || '0', 10),
      uniqueUsers: userKeys.length,
      avgResponseTime: parseFloat(data.avgResponseTime || '0'),
      last24hRequests,
    };
  } catch (error) {
    console.error('[Torznab Stats] Failed to get stats:', error);
    return {
      totalRequests: 0,
      searchRequests: 0,
      downloadRequests: 0,
      capsRequests: 0,
      tvSearchRequests: 0,
      movieSearchRequests: 0,
      errorsCount: 0,
      uniqueUsers: 0,
      avgResponseTime: 0,
      last24hRequests: 0,
    };
  }
}

/**
 * Log a Torznab request. The passkey is stripped before persistence —
 * we only keep its sha256-derived id (for indexing) and a 4+4-char
 * fingerprint (for display in the admin UI).
 */
export async function logTorznabRequest(input: TorznabLogInput): Promise<void> {
  try {
    const id = passkeyId(input.passkey);
    const persisted: TorznabLogEntry = {
      timestamp: input.timestamp,
      passkeyMasked: passkeyMask(input.passkey),
      function: input.function,
      query: input.query,
      ip: input.ip,
      userAgent: input.userAgent,
      responseTime: input.responseTime,
      resultCount: input.resultCount,
      error: input.error,
    };
    const logEntry = JSON.stringify(persisted);

    // Add to global logs (capped at 1000 entries)
    await redis.lpush(KEYS.LOGS, logEntry);
    await redis.ltrim(KEYS.LOGS, 0, 999);
    await redis.expire(KEYS.LOGS, LOGS_TTL);

    // Add to user-specific logs (indexed by id, not raw passkey)
    const userLogKey = `${KEYS.USER_LOGS}:${id}`;
    await redis.lpush(userLogKey, logEntry);
    await redis.ltrim(userLogKey, 0, 99);
    await redis.expire(userLogKey, LOGS_TTL);

    await incrementStat('totalRequests');

    switch (input.function) {
      case 'search':
        await incrementStat('searchRequests');
        break;
      case 'tvsearch':
        await incrementStat('tvSearchRequests');
        break;
      case 'movie':
        await incrementStat('movieSearchRequests');
        break;
      case 'caps':
        await incrementStat('capsRequests');
        break;
    }

    if (input.error) await incrementStat('errorsCount');

    const hourKey = `${KEYS.HOURLY}:${Math.floor(Date.now() / (60 * 60 * 1000))}`;
    await redis.incr(hourKey);
    await redis.expire(hourKey, 25 * 60 * 60);

    await updateUserStats(input.passkey, input.function);

    // Rolling average response time
    const currentAvg = parseFloat(
      (await redis.hget(KEYS.STATS, 'avgResponseTime')) || '0'
    );
    const total = parseInt(
      (await redis.hget(KEYS.STATS, 'totalRequests')) || '1',
      10
    );
    const newAvg = (currentAvg * (total - 1) + input.responseTime) / total;
    await redis.hset(KEYS.STATS, 'avgResponseTime', newAvg.toFixed(2));
  } catch (error) {
    console.error('[Torznab Stats] Failed to log request:', error);
  }
}

function decodeLog(raw: string): TorznabLogEntry | null {
  try {
    const entry = JSON.parse(raw) as TorznabLogEntry;
    // Mask the IP for display (keep the /16 for geolocation hints).
    if (entry.ip) {
      entry.ip = entry.ip.includes(':')
        ? entry.ip.split(':').slice(0, 4).join(':') + '::*'
        : entry.ip.split('.').slice(0, 2).join('.') + '.*.*';
    }
    return entry;
  } catch {
    return null;
  }
}

/**
 * Get recent logs with pagination. Logs already store a masked
 * passkey fingerprint — no further sanitisation is needed beyond IP
 * truncation for display.
 */
export async function getTorznabRecentLogs(
  limit = 50,
  offset = 0
): Promise<{ logs: TorznabLogEntry[]; total: number }> {
  try {
    const total = await redis.llen(KEYS.LOGS);
    const logs = await redis.lrange(KEYS.LOGS, offset, offset + limit - 1);
    return {
      logs: logs.map(decodeLog).filter(Boolean) as TorznabLogEntry[],
      total,
    };
  } catch (error) {
    console.error('[Torznab Stats] Failed to get logs:', error);
    return { logs: [], total: 0 };
  }
}

/**
 * Get logs for a specific user with pagination. The caller passes the
 * passkey; we hash it to look the bucket up — same path the writer
 * uses on `logTorznabRequest`.
 */
export async function getTorznabLogsByUser(
  passkey: string,
  limit = 50,
  offset = 0
): Promise<{ logs: TorznabLogEntry[]; total: number }> {
  try {
    const key = `${KEYS.USER_LOGS}:${passkeyId(passkey)}`;
    const total = await redis.llen(key);
    const logs = await redis.lrange(key, offset, offset + limit - 1);
    return {
      logs: logs.map(decodeLog).filter(Boolean) as TorznabLogEntry[],
      total,
    };
  } catch (error) {
    console.error('[Torznab Stats] Failed to get user logs:', error);
    return { logs: [], total: 0 };
  }
}

// ============================================================================
// User Stats
// ============================================================================

async function updateUserStats(passkey: string, func: string): Promise<void> {
  try {
    const id = passkeyId(passkey);
    const existing = await redis.hget(KEYS.USER_STATS, id);

    const stats: TorznabUserStats = existing
      ? JSON.parse(existing)
      : {
          totalRequests: 0,
          searchRequests: 0,
          downloadRequests: 0,
          lastRequest: 0,
          rateLimitHits: 0,
        };

    stats.totalRequests++;
    stats.lastRequest = Date.now();

    if (func === 'search' || func === 'tvsearch' || func === 'movie') {
      stats.searchRequests++;
    } else if (func === 'download') {
      stats.downloadRequests++;
    }

    await redis.hset(KEYS.USER_STATS, id, JSON.stringify(stats));
    await redis.expire(KEYS.USER_STATS, STATS_TTL);
  } catch (error) {
    console.error('[Torznab Stats] Failed to update user stats:', error);
  }
}

export async function getTorznabUserStats(
  passkey: string
): Promise<TorznabUserStats | null> {
  try {
    const data = await redis.hget(KEYS.USER_STATS, passkeyId(passkey));
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('[Torznab Stats] Failed to get user stats:', error);
    return null;
  }
}

/**
 * Clear stats for a specific user (used when resetting passkey).
 * Caller must invoke this *before* the passkey rotates so we can
 * still derive the correct id.
 */
export async function clearTorznabUserStats(passkey: string): Promise<void> {
  try {
    const id = passkeyId(passkey);
    await redis.hdel(KEYS.USER_STATS, id);
    await redis.del(`${KEYS.USER_LOGS}:${id}`);
  } catch (error) {
    console.error('[Torznab Stats] Failed to clear user stats:', error);
  }
}

/**
 * Get top users by request count. Returns the per-user fingerprint
 * (id, no passkey leak) so the admin UI can render rows; if you need
 * the actual user identity for display, join against the `users`
 * table by another channel — we no longer carry the raw passkey.
 */
export async function getTorznabTopUsers(
  limit = 10
): Promise<Array<{ passkeyId: string; stats: TorznabUserStats }>> {
  try {
    const allStats = await redis.hgetall(KEYS.USER_STATS);
    const users: Array<{ passkeyId: string; stats: TorznabUserStats }> = [];

    for (const [id, data] of Object.entries(allStats)) {
      try {
        users.push({ passkeyId: id, stats: JSON.parse(data) });
      } catch {
        // Skip invalid entries
      }
    }

    return users
      .sort((a, b) => b.stats.totalRequests - a.stats.totalRequests)
      .slice(0, limit);
  } catch (error) {
    console.error('[Torznab Stats] Failed to get top users:', error);
    return [];
  }
}

/**
 * Get requests by hour (last N hours)
 */
export async function getTorznabRequestsByHour(
  hours = 24
): Promise<Array<{ hour: number; count: number }>> {
  try {
    const now = Date.now();
    const result: Array<{ hour: number; count: number }> = [];

    for (let i = hours - 1; i >= 0; i--) {
      const timestamp = now - i * 60 * 60 * 1000;
      const hourKey = `${KEYS.HOURLY}:${Math.floor(timestamp / (60 * 60 * 1000))}`;
      const count = await redis.get(hourKey);
      result.push({
        hour: Math.floor(timestamp / (60 * 60 * 1000)) * (60 * 60 * 1000),
        count: count ? parseInt(count, 10) : 0,
      });
    }

    return result;
  } catch (error) {
    console.error('[Torznab Stats] Failed to get hourly requests:', error);
    return [];
  }
}

export async function trackRateLimitHit(passkey: string): Promise<void> {
  try {
    const id = passkeyId(passkey);
    await redis.hincrby(KEYS.RATE_LIMIT_HITS, 'total', 1);
    await redis.expire(KEYS.RATE_LIMIT_HITS, STATS_TTL);

    const existing = await redis.hget(KEYS.USER_STATS, id);
    if (existing) {
      const stats = JSON.parse(existing);
      stats.rateLimitHits = (stats.rateLimitHits || 0) + 1;
      await redis.hset(KEYS.USER_STATS, id, JSON.stringify(stats));
    }
  } catch (error) {
    console.error('[Torznab Stats] Failed to track rate limit hit:', error);
  }
}

/**
 * Get rate limit hit stats
 */
export async function getTorznabRateLimitHits(): Promise<{
  total: number;
  byHour: Array<{ hour: number; count: number }>;
}> {
  try {
    const data = await redis.hgetall(KEYS.RATE_LIMIT_HITS);
    return {
      total: parseInt(data.total || '0', 10),
      byHour: [], // Could implement hourly tracking if needed
    };
  } catch (error) {
    console.error('[Torznab Stats] Failed to get rate limit hits:', error);
    return { total: 0, byHour: [] };
  }
}

// ============================================================================
// User Blocking
// ============================================================================

export async function blockTorznabUser(
  passkey: string,
  reason: string
): Promise<void> {
  try {
    await redis.hset(
      KEYS.BLOCKED,
      passkeyId(passkey),
      JSON.stringify({ reason, blockedAt: Date.now() })
    );
  } catch (error) {
    console.error('[Torznab Stats] Failed to block user:', error);
  }
}

export async function unblockTorznabUser(passkey: string): Promise<void> {
  try {
    await redis.hdel(KEYS.BLOCKED, passkeyId(passkey));
  } catch (error) {
    console.error('[Torznab Stats] Failed to unblock user:', error);
  }
}

export async function isTorznabUserBlocked(
  passkey: string
): Promise<{ blocked: boolean; reason?: string }> {
  try {
    const data = await redis.hget(KEYS.BLOCKED, passkeyId(passkey));
    if (!data) return { blocked: false };
    const entry = JSON.parse(data);
    return { blocked: true, reason: entry.reason };
  } catch (error) {
    console.error('[Torznab Stats] Failed to check user block status:', error);
    return { blocked: false };
  }
}
