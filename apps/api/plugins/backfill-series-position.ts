/**
 * Backfill `torrents.season` / `torrents.episode` over the existing catalogue.
 *
 * The grouped listing keys television on `(tmdb_id, season)`, because a TMDb id
 * identifies the series and grouping on it alone puts every episode of every
 * season under one entry. New uploads fill the pair at upload time; everything
 * uploaded before the columns existed needs a sweep.
 *
 * **Why a cursor and not `WHERE season IS NULL`.** A null season is the correct,
 * permanent answer for a film — and for a series whose name the parser cannot
 * read. Filtering on `IS NULL` would therefore re-parse those rows on every
 * tick, forever, and the sweep would never end. Instead the plugin walks the
 * table once in `id` order and remembers where it stopped, exactly like the
 * federation catalogue cursor. When it reaches the end it records a sentinel
 * and goes quiet for good.
 *
 * Parsing a name is a handful of regexes over a short string, nothing like the
 * bencode re-parse the content-signature backfill does, so the batch is an
 * order of magnitude larger and the writes are folded into a single statement
 * per tick rather than one per row.
 */
import { db, schema } from '@trackarr/db';
import { sql } from 'drizzle-orm';
import { parseReleaseName } from '@trackarr/shared/releaseParse';
import { getSetting, setSetting } from '~~/utils/server';
import { withCronLock } from '~~/utils/cronLock';

// Adaptive pacing. A tick that filled its batch means there is more table to
// walk, so the next one follows almost immediately; a short tick means we are
// at the end and the plugin drops back to a slow heartbeat. At a fixed
// two-minute interval a 200 000-row catalogue would take thirteen hours to
// sweep — for work that is a regex over a short string, the interval was the
// entire cost.
const BUSY_INTERVAL_MS = 2_000;
const IDLE_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 90 * 1000; // after the schema push has settled
const BATCH_SIZE = 2_000;

const CURSOR_KEY = 'series_position_backfill_cursor';
const DONE = 'done';

interface TickResult {
  scanned: number;
  written: number;
  finished: boolean;
}

async function tick(): Promise<TickResult> {
  const cursor = (await getSetting(CURSOR_KEY)) ?? '';
  if (cursor === DONE) return { scanned: 0, written: 0, finished: true };

  const rows = await db
    .select({ id: schema.torrents.id, name: schema.torrents.name })
    .from(schema.torrents)
    .where(sql`${schema.torrents.id} > ${cursor}`)
    .orderBy(schema.torrents.id)
    .limit(BATCH_SIZE);

  if (rows.length === 0) {
    await setSetting(CURSOR_KEY, DONE);
    return { scanned: 0, written: 0, finished: true };
  }

  const updates: Array<{ id: string; season: number; episode: number | null }> = [];
  for (const row of rows) {
    let parsed;
    try {
      parsed = parseReleaseName(row.name);
    } catch {
      continue; // an unreadable name is simply not a series
    }
    if (parsed.season == null) continue;
    updates.push({ id: row.id, season: parsed.season, episode: parsed.episode });
  }

  if (updates.length > 0) {
    // One statement for the whole batch. `episode` is explicitly cast because
    // a VALUES list of all-nulls would otherwise be typed as text.
    const values = sql.join(
      updates.map(
        (u) =>
          sql`(${u.id}, ${u.season}::smallint, ${u.episode === null ? sql`NULL::smallint` : sql`${u.episode}::smallint`})`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      UPDATE torrents AS t
         SET season = v.season, episode = v.episode
        FROM (VALUES ${values}) AS v(id, season, episode)
       WHERE t.id = v.id
    `);
  }

  await setSetting(CURSOR_KEY, rows[rows.length - 1]!.id);
  return { scanned: rows.length, written: updates.length, finished: false };
}

export default defineNitroPlugin(() => {
  let totalWritten = 0;

  const run = async () => {
    let busy = false;
    try {
      // Cross-replica lock: every replica runs this plugin, and without it
      // they would all walk the same cursor and race each other's writes.
      await withCronLock('series_position_backfill:lock', 60, async () => {
        const { scanned, written, finished } = await tick();
        totalWritten += written;
        busy = scanned === BATCH_SIZE;
        if (finished) {
          if (totalWritten > 0) {
            console.log(
              `[SeriesPosition] backfill complete — ${totalWritten} row(s) given a season.`,
            );
            totalWritten = 0;
          }
          return; // silent from here on
        }
        console.log(
          `[SeriesPosition] backfill tick: scanned=${scanned}, written=${written}`,
        );
      });
    } catch (err) {
      console.warn('[SeriesPosition] backfill tick failed:', (err as Error).message);
    }
    // Re-arm from the outcome rather than on a fixed interval, so the sweep
    // finishes in minutes and then costs one query every five.
    setTimeout(run, busy ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS).unref?.();
  };

  setTimeout(run, FIRST_RUN_DELAY_MS).unref?.();
});
