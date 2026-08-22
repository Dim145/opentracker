/**
 * Backfill BitTorrent v2 content addressing (`info_hash_v2`, `content_root_v2`)
 * for torrents uploaded before those columns existed.
 *
 * A cursor over `torrents.id`, not a `WHERE ... IS NULL` filter, because a
 * v1-only torrent yields null forever: an IS NULL sweep would re-parse every
 * v1-only row on every tick and never finish. The cursor walks the catalogue
 * exactly once — each row is parsed a single time, v2 or not — and then idles at
 * the end. New uploads are addressed at upload time, so the backfill never has to
 * come back for them.
 *
 * The parse is the cost, so the batch is capped and a cross-replica lock keeps
 * one replica doing the work.
 */
import { db, schema } from '@trackarr/db';
import { and, asc, eq, gt, isNotNull } from 'drizzle-orm';
import { extractV2 } from '~~/utils/bittorrentV2';
import { getSetting, setSetting } from '~~/utils/server';
import { withCronLock } from '~~/utils/cronLock';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 75 * 1000;
const BATCH_SIZE = 50;
const CURSOR_KEY = 'content_root_v2_backfill_cursor';

async function tick(): Promise<{ processed: number; v2: number }> {
  const cursor = (await getSetting(CURSOR_KEY)) ?? '';

  const rows = await db
    .select({ id: schema.torrents.id, torrentData: schema.torrents.torrentData })
    .from(schema.torrents)
    .where(
      and(gt(schema.torrents.id, cursor), isNotNull(schema.torrents.torrentData)),
    )
    .orderBy(asc(schema.torrents.id))
    .limit(BATCH_SIZE);

  if (!rows.length) return { processed: 0, v2: 0 };

  let v2count = 0;
  for (const row of rows) {
    if (!row.torrentData || row.torrentData.length === 0) continue;
    try {
      const v2 = extractV2(Buffer.from(row.torrentData));
      if (v2) {
        await db
          .update(schema.torrents)
          .set({ infoHashV2: v2.infoHashV2, contentRootV2: v2.contentRootV2 })
          .where(eq(schema.torrents.id, row.id));
        v2count += 1;
      }
      // v1-only: leave both null. The cursor advancing past it is what stops
      // the re-scan — no sentinel needed.
    } catch (err) {
      console.warn(
        '[ContentRootV2] extract failed for torrent',
        row.id,
        ':',
        (err as Error).message,
      );
    }
  }

  await setSetting(CURSOR_KEY, rows[rows.length - 1]!.id);
  return { processed: rows.length, v2: v2count };
}

export default defineNitroPlugin(() => {
  const run = async () => {
    try {
      await withCronLock('content_root_v2_backfill:lock', 5 * 60, async () => {
        const { processed, v2 } = await tick();
        if (processed > 0) {
          console.log(
            `[ContentRootV2] backfill tick: processed=${processed}, v2=${v2}`,
          );
        }
      });
    } catch (err) {
      console.warn('[ContentRootV2] backfill tick failed:', (err as Error).message);
    }
  };

  setTimeout(() => {
    void run();
    setInterval(run, SWEEP_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
});
