/**
 * Roll the room's partition window forward.
 *
 * `room_messages` is partitioned by day, so retention is a `DROP` of whole
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
import { sql } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { withCronLock } from '~~/utils/cronLock';
import { getRoomRetentionDays } from '~~/utils/settings';

const LOCK_KEY = 'room_retention:lock';
const LOCK_TTL_S = 5 * 60;
/** How far ahead partitions are kept. Comfortably more than one tick. */
const CREATE_AHEAD_DAYS = 7;

export default defineNitroPlugin(() => {
  const intervalMs = Number(
    process.env.MESSAGING_ROOM_RETENTION_INTERVAL_MS ?? 6 * 60 * 60 * 1000
  );

  const tick = async () => {
    try {
      await withCronLock(LOCK_KEY, LOCK_TTL_S, async () => {
        // Interpolated, not bound — and that is not laziness.
        //
        // A `DO $$ … $$` body is a string literal to the parser, so a `$1`
        // inside it is text rather than a placeholder: the parameter never
        // reaches the block, and the statement either fails or silently
        // does nothing. This one did nothing, which is why the first
        // version of this job created partitions and dropped none.
        //
        // Interpolation is safe because both values are integers by
        // construction — clamped by the setting accessor, floored here,
        // and never strings. Anything else would need a different shape.
        const days = Math.max(1, Math.floor(await getRoomRetentionDays()));
        const ahead = sql.raw(String(CREATE_AHEAD_DAYS));
        const retention = sql.raw(String(days));

        // Create ahead. `IF NOT EXISTS` makes the whole thing idempotent,
        // so a replica that runs it twice costs nothing.
        await db.execute(sql`
          DO $$
          DECLARE
              day date := date_trunc('day', now())::date;
              stop date := date_trunc('day', now())::date + ${ahead};
          BEGIN
              WHILE day < stop LOOP
                  EXECUTE format(
                      'CREATE TABLE IF NOT EXISTS %I PARTITION OF room_messages FOR VALUES FROM (%L) TO (%L)',
                      'room_messages_' || to_char(day, 'YYYYMMDD'), day, day + 1
                  );
                  day := day + 1;
              END LOOP;
          END $$;
        `);

        // Drop behind, and report it.
        //
        // Not a `DO` block: that returns nothing, so the first version of
        // this job could not say whether it had dropped anything — and it
        // had not, which took a hand-run of the same SQL to discover. A
        // maintenance task with no output is a task nobody can tell is
        // working.
        //
        // Only partitions whose whole range is older than the cutoff. One
        // straddling it still holds messages inside retention, and
        // dropping it would take them.
        const stale = await db.execute<{ relname: string }>(sql`
          SELECT c.relname
          FROM pg_inherits i
          JOIN pg_class c ON c.oid = i.inhrelid
          WHERE i.inhparent = 'room_messages'::regclass
            AND c.relname ~ '^room_messages_[0-9]{8}$'
            AND to_date(right(c.relname, 8), 'YYYYMMDD')
                < (date_trunc('day', now()) - make_interval(days => ${retention}))::date
        `);

        const names = (stale as unknown as Array<{ relname: string }>).map(
          (r) => r.relname
        );
        for (const name of names) {
          // The name came from `pg_class` and matched a strict pattern
          // above, so it cannot carry anything else.
          await db.execute(sql`DROP TABLE IF EXISTS ${sql.raw(`"${name}"`)}`);
        }
        if (names.length > 0) {
          console.log(
            `[messaging] room retention: dropped ${names.length} partition(s) older than ${days}d`
          );
        }
      });
    } catch (err) {
      console.warn('[messaging] room retention tick failed:', (err as Error).message);
    }
  };

  // Delayed, for the same reason as the fleet broadcaster: at plugin init
  // Valkey is still connecting, `withCronLock` cannot take its lock, and
  // it returns false — **silently**. So the boot tick did nothing and the
  // next one was six hours away, which is why partitions were created by
  // the migration and never rolled forward. The symptom was fixed on the
  // fleet plugin first; the cause was here too.
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  const first = setTimeout(tick, 5_000);
  first.unref?.();
});
