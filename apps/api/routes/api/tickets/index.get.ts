/**
 * GET /api/tickets
 *
 * A member's own tickets, newest activity first. Staff see theirs here
 * too and nobody else's — the queue is a different surface with a
 * different question, and mixing them would make this list unreadable for
 * a moderator who has also opened one.
 */
import { db, schema } from '@trackarr/db';
import { and, count, desc, eq } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireTickets } from '~~/utils/tickets';
import { getTicketsMode } from '~~/utils/settings';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireTickets();
  await rateLimit(event, RATE_LIMITS.public);

  const closed = getQuery(event).closed === 'true';

  const rows = await db
    .select({
      id: schema.tickets.id,
      number: schema.tickets.number,
      subject: schema.tickets.subject,
      category: schema.tickets.category,
      status: schema.tickets.status,
      closureReason: schema.tickets.closureReason,
      assignedToId: schema.tickets.assignedToId,
      assignedToName: schema.tickets.assignedToName,
      createdAt: schema.tickets.createdAt,
      lastMessageAt: schema.tickets.lastMessageAt,
      lastMessageBy: schema.tickets.lastMessageBy,
    })
    .from(schema.tickets)
    .where(eq(schema.tickets.openedById, user.id))
    .orderBy(desc(schema.tickets.lastMessageAt))
    .limit(100);

  const [openRow] = await db
    .select({ value: count() })
    .from(schema.tickets)
    .where(
      and(
        eq(schema.tickets.openedById, user.id),
        eq(schema.tickets.status, 'open')
      )
    );

  return {
    // The mode travels with the list so the page can say "not taking new
    // ones" without a second request that would race this one.
    mode: await getTicketsMode(),
    /*
     * How many are open, whichever tab asked. The section folds itself
     * away, and a folded section still has to be able to say whether
     * there is anything under it — counting the rows it happens to be
     * holding would answer zero every time the history tab is showing.
     *
     * Its own count rather than a filter over `rows`: that list is capped
     * at a hundred, and a member with a long archive and one forgotten
     * open ticket would see the section quietly claim to be empty.
     */
    openCount: openRow?.value ?? 0,
    tickets: rows.filter((t) => (closed ? t.status !== 'open' : t.status === 'open')),
  };
});
