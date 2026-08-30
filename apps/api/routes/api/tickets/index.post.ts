/**
 * POST /api/tickets
 *
 * Open one. Addressed to the staff as a body — there is no recipient
 * field, and that is the point.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { notifyMany, listStaffRecipients } from '~~/utils/notify';
import {
  TICKET_CATEGORIES,
  requireTicketCreation,
  requireUnderTicketCaps,
} from '~~/utils/tickets';

const bodySchema = z
  .object({
    subject: z.string().trim().min(4).max(140),
    category: z.enum(TICKET_CATEGORIES).optional(),
    body: z.string().trim().min(10).max(4000),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireTicketCreation();
  await rateLimit(event, RATE_LIMITS.tickets);
  await requireUnderTicketCaps(user.id);

  const body = await validateBody(event, bodySchema);
  const id = randomUUID();
  const now = new Date();

  // One transaction: a ticket with no first message is a row nobody can
  // act on and the member cannot tell why.
  await db.transaction(async (tx) => {
    await tx.insert(schema.tickets).values({
      id,
      openedById: user.id,
      openedByName: user.username,
      category: body.category ?? 'other',
      subject: body.subject,
      status: 'open',
      createdAt: now,
      lastMessageAt: now,
      lastMessageBy: 'member',
    });
    await tx.insert(schema.ticketMessages).values({
      id: randomUUID(),
      ticketId: id,
      authorId: user.id,
      authorName: user.username,
      fromStaff: false,
      body: body.body,
      createdAt: now,
    });
  });

  // Every staff member, because it is addressed to all of them. Detached:
  // a notification fan-out must not decide whether the ticket exists.
  void (async () => {
    try {
      const staff = await listStaffRecipients();
      await notifyMany(
        staff.filter((sid) => sid !== user.id),
        'ticket_opened',
        { from: user.username, subject: body.subject },
        '/mod/tickets'
      );
    } catch (err) {
      console.warn('[tickets] staff notify failed:', (err as Error).message);
    }
  })();

  const [row] = await db
    .select({ number: schema.tickets.number })
    .from(schema.tickets)
    .where(eq(schema.tickets.id, id));

  return { id, number: row?.number ?? null };
});
