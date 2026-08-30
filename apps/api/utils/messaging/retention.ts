/**
 * The three message-retention sweeps, in one place and importable.
 *
 * They used to live inside their Nitro plugins, as closures — which put
 * them out of reach of every test, behind a try/catch that turns any
 * failure into a `console.warn`. That is the exact shape that let the
 * notification sweep ship broken for months while every operator believed
 * it was running, and two of the three below have already shipped broken
 * once for the same reason.
 *
 * So the plugins now only schedule, the way `sweepNotificationsRetention`
 * is already arranged, and each function returns what it did rather than
 * only logging it. A deletion nobody can assert on is a deletion nobody
 * can trust.
 */
import { and, eq, inArray, isNull, isNotNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { withCronLock } from '~~/utils/cronLock';
import { notify } from '~~/utils/notify';
import {
  getDmRetentionDays,
  getRoomRetentionDays,
  getTicketsMode,
} from '~~/utils/settings';

/** Rows per DELETE, and how many of them one pass will run. */
const BATCH = 2_000;
const MAX_BATCHES = 50;

/** Partitions are created this far ahead of today. */
const CREATE_AHEAD_DAYS = 7;

/** Quiet this long and the member is told the ticket is about to close… */
const WARN_AFTER_DAYS = 21;
/** …then this long again to answer before it does. */
const GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const DM_LOCK = 'dm_retention:lock';
const ROOM_LOCK = 'room_retention:lock';
const TICKET_LOCK = 'ticket_retention:lock';
const LOCK_TTL_S = 5 * 60;

/**
 * The sweep itself, exported so a test can call it.
 *
 * Its plugin only schedules. Keeping the work inside the closure
 * put it out of reach of every test, and an untested DELETE is the one
 * kind of code where being wrong is silent and permanent — the
 * notification sweep shipped broken for months for exactly that reason,
 * behind exactly this shape of try/catch.
 *
 * Returns how many rows it removed, so a caller can assert on the
 * boundary rather than on a log line.
 */
export async function sweepDmRetention(): Promise<number> {
  const days = await getDmRetentionDays();
  // Off. Not an error, and not something to log every six hours.
  if (days <= 0) return 0;

  let swept = 0;
  await withCronLock(DM_LOCK, LOCK_TTL_S, async () => {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let removed = 0;

    for (let i = 0; i < MAX_BATCHES; i += 1) {
      // The query BUILDER, not a raw `sql` template — and that is the
      // whole fix, not a style preference.
      //
      // This sweep threw on every run for as long as it has existed. A JS
      // `Date` interpolated into a raw template has no column context, so
      // drizzle applies no type mapper and the driver rejects it with
      // `ERR_INVALID_ARG_TYPE` — a Node error, client-side, before
      // anything reaches Postgres. The plugin's try/catch turned that into
      // a `console.warn`, so every instance has been publishing a
      // retention period on /privacy that nothing enforced.
      //
      // This is the second time the same mistake shipped in this codebase;
      // `sweepNotificationsRetention` carries the same note. Given the
      // column, drizzle binds a value the driver accepts.
      //
      // Still `id IN (subquery LIMIT n)`, because Postgres has no
      // `DELETE … LIMIT`. The subquery is ordered so successive batches
      // walk the oldest rows first and the work shrinks monotonically.
      const doomed = db
        .select({ id: schema.messages.id })
        .from(schema.messages)
        .where(lt(schema.messages.createdAt, cutoff))
        .orderBy(schema.messages.createdAt)
        .limit(BATCH);

      const gone = await db
        .delete(schema.messages)
        .where(inArray(schema.messages.id, doomed))
        .returning({ id: schema.messages.id });

      removed += gone.length;
      if (gone.length < BATCH) break;
    }

    if (removed > 0) {
      console.log(
        `[dm-retention] removed ${removed} message(s) older than ${days}d`
      );
    }
    swept = removed;
  });
  return swept;
}



/**
 * Roll the partitions forward, drop what has aged out, and say how many.
 *
 * Exported so a test can call it. This job has already shipped broken
 * twice — once creating partitions and dropping none, once unable to
 * report whether it had done anything — and both times the plugin's
 * try/catch is what hid it. Returns the number of partitions dropped.
 */
export async function sweepRoomRetention(): Promise<number> {
  let swept = 0;
  await withCronLock(ROOM_LOCK, LOCK_TTL_S, async () => {
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

    // Two tables now, rolled and dropped together.
    //
    // `room_message_reactions` is partitioned on the MESSAGE's day, so
    // a day's reactions sit in the partition that day's messages sit
    // in. Rolling them in lockstep is what keeps that true; letting
    // one lapse would send its inserts to the DEFAULT partition, which
    // retention never drops.
    const PARTITIONED = ['room_messages', 'room_message_reactions'] as const;

    // Create ahead. `IF NOT EXISTS` makes the whole thing idempotent,
    // so a replica that runs it twice costs nothing.
    for (const table of PARTITIONED) {
      // A table name cannot be a bound parameter, and this one is not
      // user input: it comes from the literal tuple above.
      const relation = sql.raw(table);
      const prefix = sql.raw(`'${table}_'`);
      await db.execute(sql`
        DO $$
        DECLARE
            day date := date_trunc('day', now())::date;
            stop date := date_trunc('day', now())::date + ${ahead};
        BEGIN
            WHILE day < stop LOOP
                EXECUTE format(
                    'CREATE TABLE IF NOT EXISTS %I PARTITION OF ${relation} FOR VALUES FROM (%L) TO (%L)',
                    ${prefix} || to_char(day, 'YYYYMMDD'), day, day + 1
                );
                day := day + 1;
            END LOOP;
        END $$;
      `);
    }

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
    let dropped = 0;
    for (const table of PARTITIONED) {
      const parent = sql.raw(`'${table}'`);
      const pattern = sql.raw(`'^${table}_[0-9]{8}$'`);
      const stale = await db.execute<{ relname: string }>(sql`
        SELECT c.relname
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = ${parent}::regclass
          AND c.relname ~ ${pattern}
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
      dropped += names.length;
    }
    if (dropped > 0) {
      console.log(
        `[messaging] room retention: dropped ${dropped} partition(s) older than ${days}d`
      );
    }
    swept = dropped;
  });
  return swept;
}



/**
 * Warn, then close — exported so a test can call it.
 *
 * Returns the two counts, because they are what the behaviour is: a pass
 * that warns must NOT close, and a pass that closes must only touch what
 * it warned about. Neither is observable from a log line.
 */
export async function sweepTicketRetention(): Promise<{
  warned: number;
  closed: number;
}> {
  // A desk that is off or suspended is not one to be tidying behind.
  if ((await getTicketsMode()) !== 'on') return { warned: 0, closed: 0 };

  let result = { warned: 0, closed: 0 };
  await withCronLock(TICKET_LOCK, LOCK_TTL_S, async () => {
    const now = Date.now();

    // ── Pass one: warn, once. ──────────────────────────────────
    const warned = await db
      .update(schema.tickets)
      .set({ idleNoticeAt: new Date() })
      .where(
        and(
          eq(schema.tickets.status, 'open'),
          eq(schema.tickets.lastMessageBy, 'staff'),
          isNull(schema.tickets.assignedToId),
          isNull(schema.tickets.idleNoticeAt),
          lt(schema.tickets.lastMessageAt, new Date(now - WARN_AFTER_DAYS * DAY_MS))
        )
      )
      .returning({
        id: schema.tickets.id,
        subject: schema.tickets.subject,
        openedById: schema.tickets.openedById,
      });

    for (const t of warned) {
      if (!t.openedById) continue;
      try {
        await notify(
          t.openedById,
          'ticket_idle_warning',
          { subject: t.subject, days: GRACE_DAYS },
          `/messages?ticket=${t.id}`
        );
      } catch (err) {
        console.warn('[ticket-retention] notice failed:', (err as Error).message);
      }
    }

    // ── Pass two: close the ones that stayed quiet anyway. ──────
    const closed = await db
      .update(schema.tickets)
      .set({
        status: 'closed',
        closureReason: 'stale',
        closedById: null,
        closedByName: 'system',
        closedAt: new Date(),
      })
      .where(
        and(
          eq(schema.tickets.status, 'open'),
          eq(schema.tickets.lastMessageBy, 'staff'),
          isNull(schema.tickets.assignedToId),
          isNotNull(schema.tickets.idleNoticeAt),
          lt(schema.tickets.idleNoticeAt, new Date(now - GRACE_DAYS * DAY_MS))
        )
      )
      .returning({ id: schema.tickets.id });

    if (warned.length || closed.length) {
      console.log(
        `[ticket-retention] warned ${warned.length}, closed ${closed.length}`
      );
    }
    result = { warned: warned.length, closed: closed.length };
  });
  return result;
}
