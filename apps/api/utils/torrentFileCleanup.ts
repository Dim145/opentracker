/**
 * Cleans the `.torrent` files stored before the upload learnt to.
 *
 * Two things the upload now does were never applied to the rows already there:
 *
 * - **The uploader's own fields.** Until 2026-09-02 the upload kept `announce`
 *   and `announce-list`, so a file made with the uploader's personal announce
 *   URL — the normal case — kept their passkey at rest in `torrent_data`. The
 *   route listing a member's uploads then served those bytes to anyone who
 *   opened the profile. The route no longer does, but the passkeys are still in
 *   the column, one SELECT from the next leak.
 * - **Re-keyed piece layers.** The upload decoded and re-encoded the file, and
 *   `bencode` re-spells in hex any key that is not valid UTF-8 — every key of a
 *   BEP 52 `piece layers` dict. `utils/torrentBytes` explains the fault and how
 *   the hex is turned back into the 32-byte roots.
 *
 * `cleanStoredTorrent` never touches `info`, and this checks it: the info dict
 * of what is written must be byte-identical to the one read, so neither
 * infohash can move under a swarm. A row that fails the check is logged and
 * left alone.
 *
 * Same shape as `backfill-content-roots`: a cursor over `torrents.id` walks the
 * catalogue once, in capped batches, under a cross-replica lock, then idles at
 * the end. New uploads are already clean.
 */
import { db, schema } from '@trackarr/db';
import { and, asc, eq, gt, isNotNull } from 'drizzle-orm';
import { cleanStoredTorrent } from '~~/utils/torrentBytes';
import { infoDictRange } from '~~/utils/bittorrentV2';
import { getSetting, setSetting } from '~~/utils/server';
import { panicActive } from '~~/utils/panicLock';

const BATCH_SIZE = 200;
// Bump (and say why above) whenever `cleanStoredTorrent` learns something new,
// so the sweep walks the catalogue once more.
export const CLEANUP_CURSOR_KEY = 'torrent_file_cleanup_cursor_v1';

function sameInfo(before: Buffer, after: Buffer): boolean {
  const a = infoDictRange(before);
  const b = infoDictRange(after);
  return !!a && !!b && before.subarray(a.start, a.end).equals(after.subarray(b.start, b.end));
}

/** One batch of the sweep. Exported for the integration suite. */
export async function cleanupTorrentFilesTick(): Promise<{ processed: number; cleaned: number }> {
  // Panic encrypts `torrent_data`, and an encrypted row cannot be walked: a
  // sweep during the panic would move its cursor past every one of them, and
  // nothing would come back for them after the restore.
  if (await panicActive()) return { processed: 0, cleaned: 0 };
  const cursor = (await getSetting(CLEANUP_CURSOR_KEY)) ?? '';

  const rows = await db
    .select({ id: schema.torrents.id, torrentData: schema.torrents.torrentData })
    .from(schema.torrents)
    .where(and(gt(schema.torrents.id, cursor), isNotNull(schema.torrents.torrentData)))
    .orderBy(asc(schema.torrents.id))
    .limit(BATCH_SIZE);

  if (!rows.length) return { processed: 0, cleaned: 0 };

  let cleaned = 0;
  for (const row of rows) {
    if (!row.torrentData || row.torrentData.length === 0) continue;
    const before = Buffer.from(row.torrentData);
    // Deterministic: a file that cannot be walked now never will be, so the
    // cursor moves past it. The UPDATE is the only part that can fail
    // transiently, and it is outside any catch: a failure aborts the tick
    // WITHOUT advancing the cursor, and the batch is retried next tick.
    const after = cleanStoredTorrent(before);
    if (!after) continue;
    if (!sameInfo(before, after)) {
      console.warn('[TorrentFiles] info dict would change, row left alone:', row.id);
      continue;
    }
    await db
      .update(schema.torrents)
      .set({ torrentData: after })
      .where(eq(schema.torrents.id, row.id));
    cleaned += 1;
  }

  await setSetting(CLEANUP_CURSOR_KEY, rows[rows.length - 1]!.id);
  return { processed: rows.length, cleaned };
}
