/**
 * POST /api/mod/tickets/:id/close
 *
 * Close a ticket, resolved or rejected, and say why.
 *
 * `rejected` is a closure rather than a fifth life-cycle stage. It exists
 * so a member can tell "we have dealt with this" from "we are not going
 * to" — the one distinction they actually care about — without the queue
 * growing a state that has to be maintained.
 *
 * The note is not optional in spirit even though it is in the schema: a
 * closure with no reason reads as a shrug, and the interface asks for one.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { notify } from '~~/utils/notify';
import { requireTickets } from '~~/utils/tickets';

const bodySchema = z
  .object({
    reason: z.enum(['resolved', 'rejected']),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);
  await requireTickets();
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const ticket = await db.query.tickets.findFirst({
    where: eq(schema.tickets.id, id),
  });
  if (!ticket) throw createError({ statusCode: 404, message: 'Not found' });
  if (ticket.status !== 'open') {
    throw createError({ statusCode: 409, message: 'This ticket is already closed' });
  }

  const body = await validateBody(event, bodySchema);

  await db
    .update(schema.tickets)
    .set({
      status: 'closed',
      closureReason: body.reason,
      idleNoticeAt: null,
      closedById: user.id,
      closedByName: user.username,
      closedAt: new Date(),
      closingNote: body.note ?? null,
    })
    .where(eq(schema.tickets.id, id));

  void (async () => {
    try {
      if (ticket.openedById) {
        await notify(
          ticket.openedById,
          'ticket_closed',
          { subject: ticket.subject, status: body.reason },
          `/messages?ticket=${id}`
        );
      }
    } catch (err) {
      console.warn('[tickets] close notify failed:', (err as Error).message);
    }
  })();

  return { ok: true };
});
