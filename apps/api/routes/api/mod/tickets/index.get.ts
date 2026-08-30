/**
 * GET /api/mod/tickets
 *
 * The queue. Every ticket, whoever opened it — that is what "addressed to
 * the staff" means, and a queue only some of the staff can see is a queue
 * that stalls when that person is away.
 *
 * Ordered oldest-activity-first within the open set, which is the reverse
 * of every other list in this application and deliberately so: a queue is
 * read to find what has been waiting longest, not what happened last.
 */
import { db, schema } from '@trackarr/db';
import {asc, desc, eq, sql } from 'drizzle-orm';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireTickets } from '~~/utils/tickets';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
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
      openedById: schema.tickets.openedById,
      openedByName: schema.tickets.openedByName,
      assignedToId: schema.tickets.assignedToId,
      assignedToName: schema.tickets.assignedToName,
      closedByName: schema.tickets.closedByName,
      createdAt: schema.tickets.createdAt,
      lastMessageAt: schema.tickets.lastMessageAt,
      lastMessageBy: schema.tickets.lastMessageBy,
    })
    .from(schema.tickets)
    .where(eq(schema.tickets.status, closed ? 'closed' : 'open'))
    .orderBy(
      closed
        ? desc(schema.tickets.lastMessageAt)
        : asc(schema.tickets.lastMessageAt)
    )
    .limit(200);

  const [counts] = await db
    .select({
      open: sql<number>`count(*) filter (where status = 'open')::int`,
      // The number that matters. An unassigned ticket is the one every
      // moderator assumes somebody else already took.
      untaken: sql<number>`count(*) filter (where status = 'open' and assigned_to_id is null)::int`,
      closed: sql<number>`count(*) filter (where status = 'closed')::int`,
    })
    .from(schema.tickets);

  return {
    // No `deleted-<random>` token on the way out: an erased opener has no
    // name here, and the page renders that absence like every other
    // messaging surface does.
    tickets: rows.map((r) =>
      r.openedById === null ? { ...r, openedByName: null } : r
    ),
    counts: counts ?? { open: 0, untaken: 0, closed: 0 },
  };
});
