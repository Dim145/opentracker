/**
 * Backfill `torrents.content_signature` for rows uploaded before the
 * column existed. Runs every 5 minutes, processes up to BATCH_SIZE
 * rows per tick, and stops being noisy as soon as the table is clean
 * (the `IS NULL` filter returns zero rows → tick is a no-op).
 *
 * We re-parse the stored `torrent_data` blob with `parse-torrent` to
 * pull the file list out, run it through the shared
 * `computeContentSignature` helper, and write the resulting digest
 * back. The parse is the expensive bit (a few ms per torrent on
 * average), which is why we cap the batch — a thousand-torrent
 * fleet takes a few hours to finish backfilling without ever
 * stalling the request path.
 *
 * Rows whose `torrent_data` is unparseable (legacy upload, corrupted
 * blob, …) get an empty string written so we don't keep retrying
 * them forever. The empty string never collides with a real
 * 64-char hex digest, and `WHERE content_signature IS NULL` won't
 * pick them up on the next tick.
 */
import { db, schema } from '@trackarr/db';
import { eq, isNull } from 'drizzle-orm';
import parseTorrent from 'parse-torrent';
import { computeContentSignature } from '~~/utils/contentSignature';
import { withCronLock } from '~~/utils/cronLock';

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FIRST_RUN_DELAY_MS = 60 * 1000; // 1 minute after boot
const BATCH_SIZE = 50;

async function tick(): Promise<{ processed: number; signed: number }> {
  const rows = await db
    .select({
      id: schema.torrents.id,
      torrentData: schema.torrents.torrentData,
    })
    .from(schema.torrents)
    .where(isNull(schema.torrents.contentSignature))
    .limit(BATCH_SIZE);

  let signed = 0;
  for (const row of rows) {
    if (!row.torrentData || row.torrentData.length === 0) {
      // Nothing to parse — stamp empty so we stop revisiting.
      await db
        .update(schema.torrents)
        .set({ contentSignature: '' })
        .where(eq(schema.torrents.id, row.id));
      continue;
    }
    try {
      const parsed = await parseTorrent(Buffer.from(row.torrentData));
      const signature =
        computeContentSignature({
          name: parsed.name,
          length: parsed.length,
          files: parsed.files?.map((f) => ({
            path: f.path,
            length: f.length,
          })),
        }) ?? '';
      await db
        .update(schema.torrents)
        .set({ contentSignature: signature })
        .where(eq(schema.torrents.id, row.id));
      if (signature) signed += 1;
    } catch (err: any) {
      console.warn(
        '[ContentSignature] parse failed for torrent',
        row.id,
        ':',
        err?.message,
      );
      // Stamp empty so we don't loop forever on a broken row.
      await db
        .update(schema.torrents)
        .set({ contentSignature: '' })
        .where(eq(schema.torrents.id, row.id));
    }
  }

  return { processed: rows.length, signed };
}

export default defineNitroPlugin(() => {
  const run = async () => {
    try {
      // Cross-replica lock so only one replica re-parses torrents per tick
      // (the parse is "the expensive bit") instead of every replica doing
      // the same backfill work (finding L23).
      await withCronLock('content_signature_backfill:lock', 5 * 60, async () => {
        const { processed, signed } = await tick();
        if (processed > 0) {
          console.log(
            `[ContentSignature] backfill tick: processed=${processed}, signed=${signed}`,
          );
        }
      });
    } catch (err: any) {
      console.warn('[ContentSignature] backfill tick failed:', err?.message);
    }
  };

  setTimeout(() => {
    void run();
    setInterval(run, SWEEP_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
});
