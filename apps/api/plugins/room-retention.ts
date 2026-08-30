/**
 * Roll the room's partition window forward.
 *
 * `roommessages` is partitioned by day, so retention is a `DROP` of whole
 * partitions rather than a `DELETE` over millions of rows — instant, no
 * lock held, nothing left for autovacuum. At three messages a second the
 * room writes a quarter of a million rows a day; at fourteen days that is
 * 3.6M, and the DELETE version of this would be an incident rather than a
 * chore.
 *
 * Two halves, and the first matters more than the second:
 *
 *   - **create ahead.** A day with no partition is a day the room stops
 *     accepting messages. The migration pre-created a window and there is
 *     a DEFAULT partition behind it as a net, but the net is for the case
 *     where this job has lapsed, not a substitute for it.
 *   - **drop behind.** Anything wholly older than the retention setting.
 *
 * Unlike the fleet broadcast, this one takes the cron lock. Two replicas
 * creating the same partition race on the DDL, and dropping is not
 * something to do twice by accident.
 */
import { sweepRoomRetention } from '~~/utils/messaging/retention';

export default defineNitroPlugin(() => {
  const intervalMs = Number(
    process.env.MESSAGING_ROOM_RETENTION_INTERVAL_MS ?? 6 * 60 * 60 * 1000
  );

  const tick = async () => {
    try {
      await sweepRoomRetention();
    } catch (err) {
      // A failed sweep is not fatal: nothing depends on it having run,
      // and the next tick tries again from the same arithmetic.
      console.warn('[messaging] room retention tick failed:', (err as Error).message);
    }
  };

  setTimeout(() => void tick(), 45_000);
  setInterval(() => void tick(), intervalMs);
});
