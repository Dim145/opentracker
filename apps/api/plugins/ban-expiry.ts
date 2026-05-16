/**
 * Ban-expiry cron — lifts timed bans whose `bannedUntil` has
 * elapsed and fires the `account_unbanned` notification so the
 * user finds out about it when they come back.
 *
 * The lazy paths in `utils/banExpiry.ts` (login + Torznab) and
 * `tracker/internal/server/handler.go` (announce) cover users who
 * actively try to come back. This cron is for the silent
 * majority who don't poke around — without it, a banned user
 * sees themselves as banned on `/users/:id` forever even after
 * the timestamp passed.
 *
 * Idempotent: filters on `is_banned = true`, so a row already
 * cleared by a lazy unban won't be reprocessed (and won't
 * generate a duplicate notification).
 *
 * Cross-replica: a Redis SETNX lock makes sure only one API
 * instance sweeps per tick. Other replicas no-op gracefully.
 */
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { redis } from '~~/utils/server';
import { notify } from '~~/utils/notify';
import { invalidateBanCache } from '~~/utils/adminAuth';

const LOCK_KEY = 'ban_expiry:lock';
/** Generous TTL so a slow tick can't accidentally drop the lock
 *  mid-sweep; short enough that a crashed replica releases the
 *  slot before the next scheduled run. */
const LOCK_TTL_S = 4 * 60;

export default defineNitroPlugin(async () => {
  // 5 min default — short enough that "your ban is over" feels
  // immediate, long enough that a multi-replica fleet doesn't
  // hammer Postgres for nothing.
  const INTERVAL_MS = parseInt(
    process.env.BAN_EXPIRY_INTERVAL || '300000',
    10,
  );

  console.log(
    `[Ban Expiry] Initialized — interval=${INTERVAL_MS}ms (${(
      INTERVAL_MS / 60_000
    ).toFixed(2)} min)`,
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
        'NX',
      );
      if (acquired !== 'OK') return;
      holdsLock = true;

      // Pull every row whose timed ban has elapsed. The partial
      // index `users_banned_until_idx` carries exactly this set
      // so the planner doesn't have to scan the whole users
      // table — a private tracker can stay snappy here even with
      // a 6-digit user count.
      const now = new Date();
      const expired = await db
        .select({
          id: schema.users.id,
          username: schema.users.username,
        })
        .from(schema.users)
        .where(
          and(
            eq(schema.users.isBanned, true),
            isNotNull(schema.users.bannedUntil),
            lte(schema.users.bannedUntil, now),
          ),
        );

      if (expired.length === 0) return;

      // One UPDATE covers the batch. We keep `bannedById`,
      // `bannedByRole`, `bannedUntil`, `banReason` so the audit
      // trail of the just-expired ban survives.
      await db
        .update(schema.users)
        .set({ isBanned: false })
        .where(
          and(
            eq(schema.users.isBanned, true),
            isNotNull(schema.users.bannedUntil),
            lte(schema.users.bannedUntil, now),
          ),
        );

      // Drop each user's cached `isBanned` so the next request
      // they make sees the unban without waiting for the TTL.
      // Notifications travel in parallel (best-effort).
      await Promise.all(
        expired.map(async (u) => {
          await invalidateBanCache(u.id).catch((err) => {
            console.warn(
              '[Ban Expiry] cache invalidate failed for',
              u.id,
              (err as Error).message,
            );
          });
          await notify(u.id, 'account_unbanned', { auto: true }).catch(
            (err) => {
              console.warn(
                '[Ban Expiry] notify failed for',
                u.id,
                (err as Error).message,
              );
            },
          );
        }),
      );

      console.log(
        `[Ban Expiry] Unbanned ${expired.length} user(s):`,
        expired.map((u) => u.username).join(', '),
      );
    } catch (err) {
      console.error('[Ban Expiry] sweep failed:', err);
    } finally {
      // Release the lock if we still own it. The `EVAL` check-
      // and-delete pattern keeps us from clearing a lock that
      // expired and was picked up by another replica.
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
            owner,
          );
        } catch (err) {
          console.warn(
            '[Ban Expiry] lock release failed:',
            (err as Error).message,
          );
        }
      }
    }
  };

  // Schedule the recurring sweep. `unref` so the timer doesn't
  // hold the event loop open during graceful shutdown.
  const handle = setInterval(sweep, INTERVAL_MS);
  handle.unref?.();

  // First tick on next macrotask — lets the rest of the plugins
  // finish init before we hit the DB.
  setTimeout(sweep, 5_000).unref?.();
});
