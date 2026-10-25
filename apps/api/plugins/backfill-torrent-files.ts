/**
 * Drives `utils/torrentFileCleanup`: the sweep that drops the uploader's fields
 * and repairs the piece layers of `.torrent` files stored before the upload did
 * either. The module explains both faults.
 */
import { cleanupTorrentFilesTick } from '~~/utils/torrentFileCleanup';
import { withCronLock } from '~~/utils/cronLock';

// Faster than the content-roots sweep: a row costs a byte scan, not a parse
// (only a v2 torrent is decoded, to read its roots), and every hour a passkey
// stays at rest is an hour it can leave in a backup. 200 rows a minute walks a
// 100 000-torrent catalogue in under nine hours.
const SWEEP_INTERVAL_MS = 60 * 1000;
const FIRST_RUN_DELAY_MS = 90 * 1000;

export default defineNitroPlugin(() => {
  const run = async () => {
    try {
      await withCronLock('torrent_file_cleanup:lock', 5 * 60, async () => {
        const { processed, cleaned } = await cleanupTorrentFilesTick();
        if (processed > 0) {
          console.log(`[TorrentFiles] cleanup tick: processed=${processed}, cleaned=${cleaned}`);
        }
      });
    } catch (err) {
      console.warn('[TorrentFiles] cleanup tick failed:', (err as Error).message);
    }
  };

  setTimeout(() => {
    void run();
    setInterval(run, SWEEP_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
});
