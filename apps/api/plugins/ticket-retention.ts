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
import { sweepTicketRetention } from '~~/utils/messaging/retention';

export default defineNitroPlugin(() => {
  const intervalMs = Number(
    process.env.TICKET_RETENTION_INTERVAL_MS ?? 6 * 60 * 60 * 1000
  );

  const tick = async () => {
    try {
      await sweepTicketRetention();
    } catch (err) {
      // A failed sweep is not fatal: nothing depends on it having run,
      // and the next tick tries again from the same arithmetic.
      console.warn('[ticket-retention] sweep failed:', (err as Error).message);
    }
  };

  setTimeout(() => void tick(), 90_000);
  setInterval(() => void tick(), intervalMs);
});
