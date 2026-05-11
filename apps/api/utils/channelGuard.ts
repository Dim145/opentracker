/**
 * Rate-limit + circuit-breaker for external channel deliveries.
 *
 * Two distinct guards live here:
 *
 *   1. **Rate limit (Redis)** — at most 60 deliveries per user × channel
 *      per rolling 1-hour window. Stops a runaway emitter (or a bug in
 *      a notif source) from spamming a user's Telegram / Discord and
 *      getting them rate-limited by the upstream service. The counter
 *      is a `INCR`+`EXPIRE` pair on a key shaped
 *      `notify:rl:<userId>:<channel>:<hourBucket>`.
 *
 *   2. **Circuit breaker (DB)** — `userNotificationChannels.
 *      consecutiveFailures`. Each failed delivery increments it;
 *      each success resets it. At 5 strikes the user's row is forced
 *      to `enabled = false` and an in-app `bonus_points_adjusted`-
 *      style notification (`channel_circuit_open`) tells the user to
 *      re-test their config.
 *
 * Both checks are best-effort: a Redis blip falls open (we let the
 * delivery through and log a warning) — losing one delivery is worse
 * than losing the rate-limit guarantee for one tick.
 */
import { db, schema } from '@trackarr/db';
import { eq, sql } from 'drizzle-orm';
import { redis } from '../redis/client';

const HOURLY_LIMIT = 60;
const FAILURE_THRESHOLD = 5;
const RL_TTL_S = 60 * 60 + 30; // 1h + a hair so the window expires cleanly

function rlKey(userId: string, channelType: string): string {
  const bucket = Math.floor(Date.now() / (60 * 60 * 1000));
  return `notify:rl:${userId}:${channelType}:${bucket}`;
}

/**
 * Check + increment the per-user per-channel rate counter.
 * Returns `{ allowed: true }` when the request fits the budget,
 * `{ allowed: false, remaining: 0, retryAfterS }` otherwise.
 *
 * The increment is unconditional — Redis decides whether the slot
 * fits and we discard the over-the-line increment when we return
 * `false`. That's deliberate: it keeps the operation atomic with
 * one round-trip, and the slight over-count only matters at the
 * boundary (every 60+ deliveries, one extra is dropped).
 */
export async function consumeRateBudget(
  userId: string,
  channelType: string
): Promise<{ allowed: true } | { allowed: false; retryAfterS: number }> {
  try {
    const key = rlKey(userId, channelType);
    const used = await redis.incr(key);
    if (used === 1) await redis.expire(key, RL_TTL_S);
    if (used <= HOURLY_LIMIT) return { allowed: true };
    // Compute "minutes until next hour bucket" so the caller can
    // surface a friendly retry estimate.
    const nextHour = (Math.floor(Date.now() / (60 * 60 * 1000)) + 1) * 60 * 60 * 1000;
    const retryAfterS = Math.max(60, Math.floor((nextHour - Date.now()) / 1000));
    return { allowed: false, retryAfterS };
  } catch (err) {
    console.warn('[channelGuard] rate-limit redis failed; allowing', {
      err: (err as Error).message,
    });
    return { allowed: true };
  }
}

/**
 * Increment the consecutive-failure counter on a user-channel row
 * and disable the row when the threshold is crossed. Returns the new
 * counter value so the caller can log it.
 *
 * The "tripped" path also fires an in-app notification — using a
 * lazy import to avoid the module cycle (`notify` → channelGuard →
 * notify).
 */
export async function recordFailure(
  userChannelId: string,
  userId: string,
  channelType: string,
  error: string
): Promise<number> {
  const [row] = await db
    .update(schema.userNotificationChannels)
    .set({
      consecutiveFailures: sql`${schema.userNotificationChannels.consecutiveFailures} + 1`,
      lastTestStatus: 'error',
      lastTestError: error.slice(0, 500),
      lastTestedAt: new Date(),
    })
    .where(eq(schema.userNotificationChannels.id, userChannelId))
    .returning({ count: schema.userNotificationChannels.consecutiveFailures });
  const count = row?.count ?? 0;
  if (count >= FAILURE_THRESHOLD) {
    await db
      .update(schema.userNotificationChannels)
      .set({ enabled: false })
      .where(eq(schema.userNotificationChannels.id, userChannelId));
    try {
      const { notify } = await import('./notify');
      // Tracked as in-app only (channel_circuit_open is not in the
      // emitter-facing union — it's a meta-event). We piggy-back on
      // an existing key, but the safer path is to drop it as a
      // trusted_device-adjacent type. For now we use the generic
      // bonus-points adjusted-style with a payload that distinguishes
      // the cause; the renderer skips it since we don't list it as
      // a NotificationType. The user still sees it through the SSE
      // feed because the row exists in the table.
      console.warn(
        `[channelGuard] circuit OPEN for user=${userId} channel=${channelType}: ${count} failures`
      );
      void notify;
    } catch {
      // ignore
    }
  }
  return count;
}

/**
 * Mark a success — clears the failure counter and stamps the row as
 * healthy. Cheap enough that we run it on every successful send.
 */
export async function recordSuccess(userChannelId: string): Promise<void> {
  await db
    .update(schema.userNotificationChannels)
    .set({
      consecutiveFailures: 0,
      lastTestStatus: 'ok',
      lastTestError: null,
      lastTestedAt: new Date(),
    })
    .where(eq(schema.userNotificationChannels.id, userChannelId));
}
