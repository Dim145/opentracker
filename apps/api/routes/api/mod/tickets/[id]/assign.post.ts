/**
 * POST /api/mod/tickets/:id/assign
 *
 * Take a ticket, or hand it back.
 *
 * Assignment exists for one reason: an unassigned queue is how every
 * small team ends up with everybody assuming somebody else picked it up.
 * It is not a lock — any staff member can still reply to any ticket, and
 * taking one that somebody else holds is allowed and recorded rather than
 * refused. The name is there to answer "is anyone on this", not to fence
 * it off.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireTickets } from '~~/utils/tickets';

const bodySchema = z.object({ take: z.boolean() }).strict();

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
    throw createError({ statusCode: 409, message: 'This ticket is closed' });
  }

  const body = await validateBody(event, bodySchema);

  await db
    .update(schema.tickets)
    .set(
      body.take
        ? {
            assignedToId: user.id,
            assignedToName: user.username,
            assignedAt: new Date(),
          }
        : {
            assignedToId: null,
            assignedToName: null,
            assignedAt: null,
          }
    )
    .where(eq(schema.tickets.id, id));

  return { ok: true };
});
