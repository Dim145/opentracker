/**
 * Freeleech-pool cron — drives the two cycle transitions that don't
 * happen synchronously on the contribute path:
 *
 *   1. `full_queued` → `active` once the blocking freeleech ends.
 *   2. `active`       → `ended` once `ends_at` elapses (and the
 *                       paused event, if any, is re-spawned for the
 *                       remaining duration).
 *
 * Cadence matches the ban-expiry cron (60 s) — short enough that
 * the user-visible state matches reality "the moment after the
 * blocker ends", but long enough that a multi-replica fleet isn't
 * hammering Postgres for nothing.
 *
 * Cross-replica: a Redis SETNX lock makes sure only one Nitro
 * instance sweeps per tick. Other replicas get a `null` back from
 * the SET and no-op.
 */
import { redis } from '~~/utils/server';
import { tickEndExpired, tickStartQueued } from '~~/utils/freeleechPool';

const LOCK_KEY = 'freeleech_pool:lock';
/** Generous TTL so a slow tick can't accidentally drop the lock
 *  mid-sweep; short enough that a crashed replica releases the
 *  slot before the next scheduled run. */
const LOCK_TTL_S = 90;

export default defineNitroPlugin(async () => {
  const INTERVAL_MS = parseInt(
    process.env.FREELEECH_POOL_INTERVAL || '60000',
    10
  );

  console.log(
    `[FreeleechPool] Initialized — interval=${INTERVAL_MS}ms (${(
      INTERVAL_MS / 1000
    ).toFixed(0)} s)`
  );

  const sweep = async () => {
    const owner = `${process.pid}:${Date.now()}`;
    let holdsLock = false;
    try {
      const acquired = await redis.set(
        LOCK_KEY,
        owner,
        'EX',
        LOCK_TTL_S,
        'NX'
      );
      if (acquired !== 'OK') return;
      holdsLock = true;

      const [started, ended] = await Promise.all([
        tickStartQueued().catch((err) => {
          console.warn(
            '[FreeleechPool] tickStartQueued failed:',
            (err as Error).message
          );
          return 0;
        }),
        tickEndExpired().catch((err) => {
          console.warn(
            '[FreeleechPool] tickEndExpired failed:',
            (err as Error).message
          );
          return 0;
        }),
      ]);

      if (started > 0 || ended > 0) {
        console.log(
          `[FreeleechPool] sweep — started=${started} ended=${ended}`
        );
      }
    } catch (err) {
      console.error('[FreeleechPool] sweep failed:', err);
    } finally {
      if (holdsLock) {
        try {
          await redis.eval(
            `if redis.call("GET", KEYS[1]) == ARGV[1] then
               return redis.call("DEL", KEYS[1])
             else
               return 0
             end`,
            1,
            LOCK_KEY,
            owner
          );
        } catch (err) {
          console.warn(
            '[FreeleechPool] lock release failed:',
            (err as Error).message
          );
        }
      }
    }
  };

  const handle = setInterval(sweep, INTERVAL_MS);
  handle.unref?.();

  // First tick on next macrotask — lets the rest of the plugins
  // finish init before we hit the DB.
  setTimeout(sweep, 7_000).unref?.();
});
