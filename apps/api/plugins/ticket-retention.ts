/**
 * Close the tickets the member stopped answering — after warning them.
 *
 * Closing on silence is the most dangerous default in this feature, and
 * the practice is nearly unanimous against doing it carelessly: none of
 * osTicket, Zammad, FreeScout or Discourse ships auto-close on silence at
 * all. Zendesk does, cannot be turned off, and is the reason its own
 * documentation has to explain that replies to closed tickets do not run
 * triggers — the reply arrives and nobody is told. GitHub's stale bots
 * produced the same complaint at scale: people stop reporting rather than
 * argue with a robot.
 *
 * So this sweep is deliberately timid. It runs in two passes and only
 * ever touches a ticket where all three hold:
 *
 *   - **the staff answered it** (`lastMessageBy = 'staff'`). One nobody
 *     replied to is never touched. A sweep that closed those would be
 *     absolving the staff of its own silence, which is the exact failure
 *     the queue exists to make visible;
 *   - **nobody holds it.** A ticket somebody took is theirs to finish;
 *   - **it has gone quiet** for long enough.
 *
 * Pass one warns and stamps `idleNoticeAt`. Pass two closes, seven days
 * later, and only a ticket that still carries that stamp. Any message
 * from either side clears the stamp, so a member who answers is never
 * closed on. The closure is attributed to the system and reasoned
 * `stale`, because "we closed this because you went quiet" and "we dealt
 * with this" are different things to be told.
 *
 * It matters more here than upstream: a member may hold three open
 * tickets, so one the staff answered and they forgot about is a slot they
 * cannot get back on their own.
 */
import { and, eq, isNull, isNotNull, lt } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { withCronLock } from '~~/utils/cronLock';
import { notify } from '~~/utils/notify';
import { getTicketsMode } from '~~/utils/settings';

const LOCK_KEY = 'ticket_retention:lock';
const LOCK_TTL_S = 5 * 60;

/** Quiet this long, and the member is told it is about to close. */
const WARN_AFTER_DAYS = 21;
/** Then this long again to answer before it does. */
const GRACE_DAYS = 7;

const day = 24 * 60 * 60 * 1000;

export default defineNitroPlugin(() => {
  const intervalMs = Number(
    process.env.TICKET_RETENTION_INTERVAL_MS ?? 6 * 60 * 60 * 1000
  );

  const tick = async () => {
    try {
      // A desk that is off or suspended is not one to be tidying behind.
      if ((await getTicketsMode()) !== 'on') return;

      await withCronLock(LOCK_KEY, LOCK_TTL_S, async () => {
        const now = Date.now();

        // ── Pass one: warn, once. ──────────────────────────────────
        const warned = await db
          .update(schema.tickets)
          .set({ idleNoticeAt: new Date() })
          .where(
            and(
              eq(schema.tickets.status, 'open'),
              eq(schema.tickets.lastMessageBy, 'staff'),
              isNull(schema.tickets.assignedToId),
              isNull(schema.tickets.idleNoticeAt),
              lt(schema.tickets.lastMessageAt, new Date(now - WARN_AFTER_DAYS * day))
            )
          )
          .returning({
            id: schema.tickets.id,
            subject: schema.tickets.subject,
            openedById: schema.tickets.openedById,
          });

        for (const t of warned) {
          if (!t.openedById) continue;
          try {
            await notify(
              t.openedById,
              'ticket_idle_warning',
              { subject: t.subject, days: GRACE_DAYS },
              `/messages?ticket=${t.id}`
            );
          } catch (err) {
            console.warn('[ticket-retention] notice failed:', (err as Error).message);
          }
        }

        // ── Pass two: close the ones that stayed quiet anyway. ──────
        const closed = await db
          .update(schema.tickets)
          .set({
            status: 'closed',
            closureReason: 'stale',
            closedById: null,
            closedByName: 'system',
            closedAt: new Date(),
          })
          .where(
            and(
              eq(schema.tickets.status, 'open'),
              eq(schema.tickets.lastMessageBy, 'staff'),
              isNull(schema.tickets.assignedToId),
              isNotNull(schema.tickets.idleNoticeAt),
              lt(schema.tickets.idleNoticeAt, new Date(now - GRACE_DAYS * day))
            )
          )
          .returning({ id: schema.tickets.id });

        if (warned.length || closed.length) {
          console.log(
            `[ticket-retention] warned ${warned.length}, closed ${closed.length}`
          );
        }
      });
    } catch (err) {
      console.warn('[ticket-retention] sweep failed:', (err as Error).message);
    }
  };

  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), intervalMs);
});
