/**
 * POST /api/tickets/:id/messages
 *
 * A line on a ticket, from either side.
 *
 * One route rather than two, because the rule is the same for both: an
 * open ticket takes lines from its member and from any staff member, and
 * a closed one takes none from anybody. Closed means closed in both
 * directions — that is what makes it a decision rather than a mood.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { notify, notifyMany, listStaffRecipients } from '~~/utils/notify';
import {
  requireTickets,
  ticketFor,
  type TicketStatus,
} from '~~/utils/tickets';

const bodySchema = z.object({ body: z.string().trim().min(1).max(4000) }).strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  // `requireTickets`, not `requireTicketCreation`: a suspended desk still
  // works on what is already open. That is the whole difference between
  // suspending and switching off.
  await requireTickets();
  await rateLimit(event, RATE_LIMITS.tickets);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const ticket = await ticketFor(id, user);
  if (!ticket) throw createError({ statusCode: 404, message: 'Not found' });

  if (ticket.status !== 'open') {
    throw createError({
      statusCode: 409,
      message: 'This ticket is closed',
    });
  }

  const body = await validateBody(event, bodySchema);
  // Safe to read off the session object here, and only here: `ticketFor`
  // above reconciled these flags against the live role and mutated this
  // very object. Read them before that call and a freshly promoted
  // moderator writes to the ticket as the member.
  const fromStaff = !!user.isAdmin || !!user.isModerator;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(schema.ticketMessages).values({
      id: randomUUID(),
      ticketId: id,
      authorId: user.id,
      authorName: user.username,
      fromStaff,
      body: body.body,
      createdAt: now,
    });
    // `lastMessageBy` is what "waiting on whom" is read off. Stored rather
    // than a status, because a status has to be maintained by hand and
    // this cannot disagree with the thread above it.
    /*
     * Claim on response.
     *
     * The first staff member to answer an unassigned ticket becomes the
     * one handling it. Assignment as a side effect of the work rather
     * than a button somebody has to remember, which is what stops it
     * going stale — osTicket ships this on by default (`auto_claim_
     * tickets`) and it is the closest thing the field has to a settled
     * answer for small teams. The explicit take/hand-back buttons are
     * still there for the cases that need saying out loud.
     *
     * Not a lock: any staff member can still answer any ticket, and
     * taking one somebody else holds is allowed. The name answers "is
     * anyone on this", it does not fence anything off.
     */
    const claim =
      fromStaff && !ticket.assignedToId
        ? {
            assignedToId: user.id,
            assignedToName: user.username,
            assignedAt: now,
          }
        : {};

    await tx
      .update(schema.tickets)
      .set({
        lastMessageAt: now,
        lastMessageBy: fromStaff ? 'staff' : 'member',
        // Somebody spoke: the auto-close countdown starts over from
        // nothing. Without this a member who answers on day 27 is still
        // closed on day 28, which is the failure that makes people stop
        // using a ticket desk.
        idleNoticeAt: null,
        ...claim,
      })
      .where(eq(schema.tickets.id, id));
  });

  void (async () => {
    try {
      if (fromStaff) {
        if (ticket.openedById) {
          await notify(
            ticket.openedById,
            'ticket_answered',
            { from: user.username, subject: ticket.subject },
            `/messages?ticket=${id}`
          );
        }
      } else {
        // To the assignee if there is one, to everybody if there is not:
        // an unassigned ticket is nobody's until somebody takes it.
        const recipients = ticket.assignedToId
          ? [ticket.assignedToId]
          : (await listStaffRecipients()).filter((sid) => sid !== user.id);
        await notifyMany(
          recipients,
          'ticket_opened',
          { from: user.username, subject: ticket.subject },
          '/mod/tickets'
        );
      }
    } catch (err) {
      console.warn('[tickets] reply notify failed:', (err as Error).message);
    }
  })();

  return { ok: true };
});
