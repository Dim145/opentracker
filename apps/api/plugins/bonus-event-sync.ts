/**
 * Keeps the tracker's view of the running bonus event current.
 *
 * The tracker reads the active event from `bonus:active`, a snapshot written
 * with a five-minute TTL. Nothing rewrote it on a schedule: only admin edits,
 * the freeleech pool's own transitions, and a read that found it expired —
 * `/api/bonus/active` from a browser, a Torznab search, an IRC announce. Five
 * quiet minutes, a night on a small instance, and the tracker went back to
 * 1×/1× in the middle of a freeleech; and a scheduled event only started at
 * the first page view after its start time, its start notification with it.
 *
 * Once a minute, under a cross-replica lock. `syncActiveSnapshot` is idempotent
 * and its start broadcast is guarded per event, so a replica that misses a tick
 * costs nothing.
 */
import { syncActiveSnapshot } from '~~/utils/bonusEvents';
import { withCronLock } from '~~/utils/cronLock';

const SYNC_INTERVAL_MS = 60 * 1000;

export default defineNitroPlugin(() => {
  const run = async () => {
    try {
      await withCronLock('bonus_event_sync:lock', 50, async () => {
        await syncActiveSnapshot();
      });
    } catch (err) {
      console.warn('[BonusEvents] snapshot sync failed:', (err as Error).message);
    }
  };

  // Soon after boot: a restart in the middle of an event must not leave the
  // tracker without it until somebody browses.
  setTimeout(() => {
    void run();
    setInterval(run, SYNC_INTERVAL_MS);
  }, 5 * 1000);
});
