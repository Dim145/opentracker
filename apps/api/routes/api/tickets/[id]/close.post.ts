/**
 * POST /api/tickets/:id/close
 *
 * The member closing their own ticket.
 *
 * Separate from the staff route rather than a flag on it, because they
 * are not the same act and must not be able to impersonate each other: a
 * member may end only their own ticket, may not reject anybody's, and
 * leaves `withdrawn` behind rather than "resolved". A desk that records
 * "we sorted it" every time somebody gives up cannot tell whether it is
 * working.
 *
 * Deliberately no note. The staff writes one because a closure the member
 * did not choose needs explaining; a member who no longer needs help owes
 * nobody a paragraph, and an empty required field is how you teach people
 * to type "n/a".
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { notify } from '~~/utils/notify';
import { requireTickets, ticketFor } from '~~/utils/tickets';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  // `requireTickets`, not `requireTicketCreation`: a suspended desk still
  // lets people finish what is already open, and closing is finishing.
  await requireTickets();
  await rateLimit(event, RATE_LIMITS.tickets);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const ticket = await ticketFor(id, user);
  if (!ticket) throw createError({ statusCode: 404, message: 'Not found' });

  // Theirs, and only theirs — a moderator reading somebody else's ticket
  // goes through the staff route, which records who did it and why.
  if (ticket.openedById !== user.id) {
    throw createError({ statusCode: 403, message: 'Not your ticket' });
  }
  if (ticket.status !== 'open') {
    throw createError({ statusCode: 409, message: 'This ticket is closed' });
  }

  await db
    .update(schema.tickets)
    .set({
      status: 'closed',
      closureReason: 'withdrawn',
      idleNoticeAt: null,
      closedById: user.id,
      closedByName: user.username,
      closedAt: new Date(),
      closingNote: null,
    })
    .where(eq(schema.tickets.id, id));

  // Only whoever was holding it. Nobody took it, nobody was interrupted,
  // and telling the whole staff a stranger's ticket went away is noise.
  void (async () => {
    try {
      if (ticket.assignedToId && ticket.assignedToId !== user.id) {
        await notify(
          ticket.assignedToId,
          'ticket_closed',
          { subject: ticket.subject, status: 'withdrawn' },
          `/mod/tickets?id=${id}`
        );
      }
    } catch (err) {
      console.warn('[tickets] withdraw notify failed:', (err as Error).message);
    }
  })();

  return { ok: true };
});
