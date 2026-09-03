/**
 * Login-history retention sweep.
 *
 * Rows survive `login_event_retention_days` (default 90, `0` = forever) and are
 * then deleted by age. Ninety days rather than the audit log's year: this is a
 * high-volume table — one row per login attempt per member — and the questions
 * it answers ("was that me last week", "is this account being shared right
 * now") are asked about the recent past.
 *
 * Published on `/privacy` beside every other period, because it is a record of
 * a member's own activity rather than of staff decisions.
 */
import { lt } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { getLoginEventRetentionDays } from '~~/utils/server';
import { withCronLock } from '~~/utils/cronLock';

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 7 * 60 * 1000;

export default defineNitroPlugin(() => {
  const tick = async () => {
    try {
      await withCronLock('login_event_retention:lock', 10 * 60, async () => {
        const days = await getLoginEventRetentionDays();
        if (days <= 0) return;

        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const deleted = await db
          .delete(schema.loginEvents)
          .where(lt(schema.loginEvents.createdAt, cutoff))
          .returning({ id: schema.loginEvents.id });

        if (deleted.length > 0) {
          console.log(
            `[LoginRetention] swept ${deleted.length} events older than ${days}d`
          );
        }
      });
    } catch (err) {
      const e = err as { message?: string; cause?: { code?: string; message?: string } };
      console.error(
        '[LoginRetention] sweep failed:',
        e?.message,
        e?.cause ? `| cause: ${e.cause.code ?? ''} ${e.cause.message ?? ''}` : ''
      );
    }
  };

  setTimeout(() => {
    void tick();
    setInterval(tick, SWEEP_INTERVAL_MS);
  }, FIRST_RUN_DELAY_MS);
});
