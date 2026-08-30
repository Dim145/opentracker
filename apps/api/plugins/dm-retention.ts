/**
 * Delete private messages past the operator's window.
 *
 * `messages` is a plain table, not partitioned like `roommessages`: a
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
import { sweepDmRetention } from '~~/utils/messaging/retention';

export default defineNitroPlugin(() => {
  const intervalMs = Number(
    process.env.MESSAGING_DM_RETENTION_INTERVAL_MS ?? 6 * 60 * 60 * 1000
  );

  const tick = async () => {
    try {
      await sweepDmRetention();
    } catch (err) {
      // A failed sweep is not fatal: nothing depends on it having run,
      // and the next tick tries again from the same arithmetic.
      console.warn('[dm-retention] sweep failed:', (err as Error).message);
    }
  };

  // Not on boot: a fresh process should serve requests before it starts
  // deleting. The room sweep makes the same choice.
  setTimeout(() => void tick(), 60_000);
  setInterval(() => void tick(), intervalMs);
});
