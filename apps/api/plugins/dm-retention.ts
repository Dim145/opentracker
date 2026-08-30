/**
 * Delete private messages past the operator's window.
 *
 * `messages` is a plain table, not partitioned like `room_messages`: a
 * private conversation is a handful of rows a year rather than a quarter
 * of a million a day, so a partition per day would be almost entirely
 * empty and the planner would carry the cost for nothing. Retention here
 * is therefore a `DELETE`, and a `DELETE` over somebody's correspondence
 * has to be careful in ways a `DROP PARTITION` does not:
 *
 *   - **Off unless asked.** Zero is the default and stays zero on
 *     upgrade. Every other retention in this codebase defaults to a
 *     window because the rows belong to the instance; these belong to the
 *     members, and turning it on for them at deploy time would delete
 *     correspondence nobody told them was on a timer.
 *   - **Batched.** One statement over years of history is a long lock on
 *     a table two live surfaces read. A bounded batch per pass, repeated
 *     until it comes up short, keeps every individual statement small.
 *   - **Bounded per tick.** If a window is shortened from a year to a
 *     month, the first sweep has a year of rows to remove. It does as
 *     much as the cap allows and leaves the rest for the next tick rather
 *     than holding the table for however long that takes.
 *   - **The conversation survives its messages.** Only rows go. A
 *     conversation with nothing left in it still lists, still says who it
 *     is with, and can still be written into — the alternative is threads
 *     vanishing from an inbox with no explanation.
 *
 * The counters are denormalised (`unreadCount`, `lastMessageAt`), and
 * they are deliberately NOT recomputed here: a message old enough to be
 * swept is old enough to have been read, and `lastMessageAt` orders a
 * list rather than claiming a row still exists.
 */
import { sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { withCronLock } from '~~/utils/cronLock';
import { getDmRetentionDays } from '~~/utils/settings';

const LOCK_KEY = 'dm_retention:lock';
const LOCK_TTL_S = 5 * 60;
/** Rows per statement. Small enough that the lock is never felt. */
const BATCH = 2_000;
/** Statements per tick. `BATCH * MAX_BATCHES` is the ceiling per pass. */
const MAX_BATCHES = 50;

export default defineNitroPlugin(() => {
  const intervalMs = Number(
    process.env.MESSAGING_DM_RETENTION_INTERVAL_MS ?? 6 * 60 * 60 * 1000
  );

  const tick = async () => {
    try {
      const days = await getDmRetentionDays();
      // Off. Not an error, and not something to log every six hours.
      if (days <= 0) return;

      await withCronLock(LOCK_KEY, LOCK_TTL_S, async () => {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        let removed = 0;

        for (let i = 0; i < MAX_BATCHES; i += 1) {
          // `IN (subquery LIMIT n)` rather than `DELETE … LIMIT`, which
          // Postgres does not have. The subquery is ordered so successive
          // batches walk the oldest rows first and the work shrinks
          // monotonically.
          const result = await db.execute(sql`
            DELETE FROM ${schema.messages}
             WHERE id IN (
               SELECT id FROM ${schema.messages}
                WHERE created_at < ${cutoff}
                ORDER BY created_at
                LIMIT ${BATCH}
             )
          `);
          const n = Number((result as { count?: number }).count ?? 0);
          removed += n;
          if (n < BATCH) break;
        }

        if (removed > 0) {
          console.log(
            `[dm-retention] removed ${removed} message(s) older than ${days}d`
          );
        }
      });
    } catch (err) {
      // A failed sweep is not fatal: nothing depends on it having run, and
      // the next tick tries again with the same cutoff arithmetic.
      console.warn('[dm-retention] sweep failed:', (err as Error).message);
    }
  };

  // Not on boot: a fresh process should serve requests before it starts
  // deleting. The room sweep makes the same choice.
  setTimeout(() => void tick(), 60_000);
  setInterval(() => void tick(), intervalMs);
});
