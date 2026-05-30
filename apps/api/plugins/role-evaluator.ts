/**
 * Periodic role-evaluation sweep.
 *
 * The per-mutation hooks (approve, reject, role assign, role edit)
 * cover ~99% of the cases that flip a user's auto-role eligibility,
 * but they can't catch:
 *
 *   - rules that depend on `accountAgeDays` (no event ever fires
 *     when "30 days passed since registration")
 *   - bulk-import side effects (e.g. an admin manipulates uploaded /
 *     downloaded counters directly)
 *   - any mutation we forgot to instrument
 *
 * A 30-min sweep is the cheapest catch-all. The evaluator is bounded
 * (skips banned + manually-overridden users) and the per-user query
 * is two SELECTs + an UPDATE, so even a few thousand users finish in
 * single-digit seconds.
 */

import { reevaluateAllUsers } from '~~/utils/roleRules';

const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const FIRST_RUN_DELAY_MS = 60 * 1000; // wait 1 min after boot

export default defineNitroPlugin(() => {
  const tick = async () => {
    try {
      const result = await reevaluateAllUsers();
      // reevaluateAllUsers returns { considered, attached, detached } —
      // the old log read result.changed / result.skipped, which don't
      // exist (always undefined → the log never fired).
      if (result.attached + result.detached > 0) {
        console.log(
          `[Roles] sweep: ${result.considered} considered, ${result.attached} attached, ${result.detached} detached`
        );
      }
    } catch (err) {
      console.error('[Roles] sweep failed:', err);
    }
  };

  // Skew the first run so a fleet-wide redeploy doesn't have every
  // instance hammering the DB at the same second. The unref on both
  // timers keeps a graceful-shutdown SIGTERM from waiting on them.
  const start = setTimeout(() => {
    void tick();
  }, FIRST_RUN_DELAY_MS);
  start.unref?.();

  const interval = setInterval(() => {
    void tick();
  }, SWEEP_INTERVAL_MS);
  interval.unref?.();
});
