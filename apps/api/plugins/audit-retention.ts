/**
 * Audit-log retention sweep.
 *
 * Entries survive `audit_log_retention_days` (default 365, `0` = forever) and
 * are then deleted by age. This is the ONLY thing in the application that
 * removes an audit row — see the note on the table: a register whose entries
 * can be amended by the people it registers is not a register, so there is no
 * edit path and no per-row delete, and the retention period is published on
 * `/api/privacy` where a member can read it.
 *
 * A year rather than the 90 days notifications get, because the question an
 * audit log answers tends to be asked late: after a member disputes a ban, or
 * after a staff account turns out to have been borrowed weeks ago.
 *
 * Daily, with a delay after boot: the table is small next to `notifications`
 * (one row per staff mutation, not one per member event) and nothing here is
 * urgent enough to compete with cold start.
 */
import { lt } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { getAuditRetentionDays } from '~~/utils/server';
import { withCronLock } from '~~/utils/cronLock';

const SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000;

export default defineNitroPlugin(() => {
  const tick = async () => {
    try {
      await withCronLock('audit_retention:lock', 10 * 60, async () => {
        const days = await getAuditRetentionDays();
        if (days <= 0) return; // keep indefinitely

        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        const deleted = await db
          .delete(schema.auditLog)
          .where(lt(schema.auditLog.createdAt, cutoff))
          .returning({ id: schema.auditLog.id });

        if (deleted.length > 0) {
          console.log(
            `[AuditRetention] swept ${deleted.length} entries older than ${days}d`
          );
        }
      });
    } catch (err) {
      // `console.error` with the cause chain — the notification sweep failed
      // silently for months behind a `warn` carrying only `err.message`, and
      // drizzle's message can point at the wrong layer entirely.
      const e = err as { message?: string; cause?: { code?: string; message?: string } };
      console.error(
        '[AuditRetention] sweep failed:',
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
