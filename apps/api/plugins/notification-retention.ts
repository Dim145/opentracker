/**
 * Notification retention sweep.
 *
 * Two TTLs drive the cleanup: read rows survive
 * `notifications_retention_read_days` (default 90); unread rows
 * survive `notifications_retention_unread_days` (default 90). An
 * operator can bump either from /admin/settings without restarting.
 *
 * The sweep runs every 6 hours — chatty enough to keep the table
 * small on a busy tracker, gentle enough that a Postgres lock
 * spike on the `notifications` table is unlikely to clash with a
 * burst of bell-dropdown reads. The first run is delayed 2 min
 * after boot so it doesn't pile onto the cold-start period when
 * /api/me/* requests typically peak.
 */
import { sweepNotificationsRetention } from '~~/utils/notify';

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000; // 2 minutes

export default defineNitroPlugin(() => {
  const tick = async () => {
    try {
      const { deletedRead, deletedUnread } =
        await sweepNotificationsRetention();
      if (deletedRead > 0 || deletedUnread > 0) {
        console.log(
          `[NotifyRetention] swept ${deletedRead} read + ${deletedUnread} unread rows`,
        );
      }
    } catch (err: any) {
      // `console.error`, and the cause chain with it.
      //
      // This handler is why a sweep that failed on every run since the feature
      // shipped went unnoticed: a `warn` carrying only `err.message` in a log
      // nobody greps. And `err.message` was actively misleading — drizzle builds
      // it by stringifying the ORIGINAL parameters, so it showed
      // `Fri May 29 2026 …`, the Date's `toString()`, and pointed at a Postgres
      // parse failure. The real error was `ERR_INVALID_ARG_TYPE`, thrown by the
      // driver client-side, and it was only in `err.cause`.
      console.error(
        '[NotifyRetention] sweep failed:',
        err?.message,
        err?.cause ? `| cause: ${err.cause.code ?? ''} ${err.cause.message ?? err.cause}` : '',
      );
    }
  };

  setTimeout(() => {
    void tick();
    setInterval(tick, SWEEP_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
});
