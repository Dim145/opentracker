/**
 * Hit-and-run sweep — flags the downloads whose grace period ran out before
 * their seeding requirement was met, and notifies the member.
 *
 * `checkAndMarkHnrs()` used to run only when a moderator opened the H&R page
 * with `?check=true`, although the guide described a loop: on an instance
 * nobody moderated by hand, nobody was ever flagged. It runs here on its own
 * now, idempotent (it only flips rows still `is_hnr = false`), under a
 * cross-replica lock so the notifications go out once.
 */
import { checkAndMarkHnrs } from '~~/utils/hnr';
import { withCronLock } from '~~/utils/cronLock';

// Grace periods are counted in hours; ten minutes is late enough to cost
// nothing and early enough that the notification reads as "now".
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;

export default defineNitroPlugin(() => {
  const run = async () => {
    try {
      await withCronLock('hnr_sweep:lock', 5 * 60, async () => {
        const flagged = await checkAndMarkHnrs();
        if (flagged > 0) console.log(`[HnR] sweep flagged ${flagged} download(s)`);
      });
    } catch (err) {
      console.warn('[HnR] sweep failed:', (err as Error).message);
    }
  };

  setTimeout(() => {
    void run();
    setInterval(run, SWEEP_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
});
