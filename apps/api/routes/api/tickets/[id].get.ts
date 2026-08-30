/**
 * GET /api/tickets/:id
 *
 * One ticket and its whole thread. Staff see any; a member sees theirs
 * and gets 404 for anyone else's — an id must not be a way to learn that
 * a ticket exists.
 */
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireTickets, ticketFor, ticketThread } from '~~/utils/tickets';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireTickets();
  await rateLimit(event, RATE_LIMITS.public);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const ticket = await ticketFor(id, user);
  if (!ticket) throw createError({ statusCode: 404, message: 'Not found' });

  return {
    // Same rule as the queue: the erasure token is a record, not a label.
    ticket:
      ticket.openedById === null ? { ...ticket, openedByName: null } : ticket,
    messages: await ticketThread(id),
    /*
     * Whether THIS caller may end it, decided here rather than in the
     * page. The component then renders a control it knows the server will
     * honour, instead of re-deriving the rule from an id comparison that
     * has to be kept in step with `close.post.ts` by hand.
     */
    canClose: ticket.status === 'open' && ticket.openedById === user.id,
  };
});
