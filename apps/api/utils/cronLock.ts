import { redis } from '~~/utils/server';

/**
 * Run `fn` under a best-effort cross-replica Redis lock so that, on a
 * horizontally-scaled deployment, only ONE API instance executes a given
 * cron tick. Returns true if this replica ran it, false if another replica
 * held the lock (or Redis was unreachable) and we skipped.
 *
 * Released via a Lua compare-and-swap so we never drop a lock a different
 * replica acquired after our TTL lapsed; a crashed holder is covered by the
 * TTL. Mirrors the inline pattern already used by bonus-collector /
 * ban-expiry / freeleech-pool (findings L20, L23).
 */
export async function withCronLock(
  lockKey: string,
  ttlSeconds: number,
  fn: () => Promise<void>,
): Promise<boolean> {
  const owner = `${process.pid}:${Date.now()}`;
  let acquired: string | null = null;
  try {
    acquired = await redis.set(lockKey, owner, 'EX', ttlSeconds, 'NX');
  } catch {
    // Redis unreachable — skip this tick; the next one retries. (Failing
    // closed avoids every replica running unlocked during a Redis outage.)
    return false;
  }
  if (acquired !== 'OK') return false;

  try {
    await fn();
  } finally {
    try {
      await redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then
           return redis.call('DEL', KEYS[1])
         else
           return 0
         end`,
        1,
        lockKey,
        owner,
      );
    } catch {
      /* TTL will release it */
    }
  }
  return true;
}
