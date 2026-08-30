/**
 * POST /api/mod/tickets/:id/reopen
 *
 * Undo a closure. Staff only, and deliberately not offered to the member.
 *
 * A closed ticket is closed in both directions — that is the rule, and
 * letting the member lift it would make closing a suggestion. But a
 * mis-clicked closure would otherwise force somebody to open a second
 * ticket and re-explain, splitting the history across two threads for a
 * mistake that took one click to make.
 *
 * It comes back unassigned. Whoever closed it is not necessarily the one
 * picking it up again, and leaving the old assignee on it would say
 * somebody is handling something they may not know reopened.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireTickets } from '~~/utils/tickets';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await requireTickets();
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const ticket = await db.query.tickets.findFirst({
    where: eq(schema.tickets.id, id),
  });
  if (!ticket) throw createError({ statusCode: 404, message: 'Not found' });
  if (ticket.status === 'open') {
    throw createError({ statusCode: 409, message: 'This ticket is already open' });
  }

  await db
    .update(schema.tickets)
    .set({
      status: 'open',
      closureReason: null,
      idleNoticeAt: null,
      assignedToId: null,
      assignedToName: null,
      assignedAt: null,
      closedById: null,
      closedByName: null,
      closedAt: null,
      closingNote: null,
    })
    .where(eq(schema.tickets.id, id));

  return { ok: true };
});
