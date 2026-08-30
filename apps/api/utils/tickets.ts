/**
 * Tickets: a member writing to the staff as a body rather than to a person.
 *
 * The distinction is the feature. A direct message to a named moderator
 * dies when they stop being one, and nobody else ever learns it existed;
 * a ticket outlives whoever was on shift, and the next person can pick it
 * up because they can see it.
 *
 * Deliberately NOT built on `conversations`. That table carries blocking,
 * per-pair uniqueness, optional encryption, archiving, muting and the
 * first-contact queue, and a ticket wants none of them — two of them
 * would be wrong outright, since a member who has blocked a moderator
 * must still reach the staff, and there is nobody to encrypt to when the
 * recipient is a role.
 */
import { db, schema } from '@trackarr/db';
import { and, count, eq, gte } from 'drizzle-orm';
import { reconcileStaffRoles } from './adminAuth';
import { getTicketsMode, type TicketsMode } from './settings';

export const TICKET_CATEGORIES = [
  'appeal',
  'upload',
  'account',
  'bug',
  'other',
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/**
 * Two states, because there are two: it is being dealt with, or it is
 * finished. Everything a helpdesk is tempted to add here is derived —
 * "taken" is an assignee, "waiting on the member" is who spoke last.
 */
export const TICKET_STATUSES = ['open', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Why it ended, which is a different question from whether it ended.
 *
 * `rejected` is the word the member reads, and it lives here rather than
 * in `status` so that "is this finished" stays one comparison. `stale` is
 * the desk closing its own untouched business and says so plainly instead
 * of pretending a human resolved it, and `withdrawn` is the member ending
 * their own — three different things that a single "closed" would blur.
 */
export const CLOSURE_REASONS = [
  'resolved',
  'rejected',
  'stale',
  'withdrawn',
] as const;
export type ClosureReason = (typeof CLOSURE_REASONS)[number];

/**
 * How many a member may have open at once, and how many they may open in
 * a day.
 *
 * A ticket desk is a way for anybody to reach the staff that bypasses
 * blocking, and that is correct — but it is also, for the same reason, a
 * harassment vector pointed at the moderators. The queue is the thing
 * being protected here, not the database.
 */
export const MAX_OPEN_PER_MEMBER = 3;
export const MAX_PER_DAY = 5;

/**
 * The surface exists at all.
 *
 * 404 rather than 403, like the rest of the messaging surface: an
 * instance that does not run a ticket desk should look like a build that
 * never had one.
 */
export async function requireTickets(): Promise<TicketsMode> {
  const mode = await getTicketsMode();
  if (mode === 'off') {
    throw createError({ statusCode: 404, message: 'Not found' });
  }
  return mode;
}

/**
 * And a NEW one may be opened.
 *
 * Separate from the above on purpose: `suspended` is the state where the
 * page is still there and every open ticket still works. Answering 404
 * here would tell a member the feature had vanished while their own
 * ticket was plainly still on screen.
 */
export async function requireTicketCreation(): Promise<void> {
  const mode = await requireTickets();
  if (mode === 'suspended') {
    throw createError({
      statusCode: 409,
      message: 'The ticket desk is not taking new tickets right now',
    });
  }
}

/** Refuse a member who already has too many in flight. */
export async function requireUnderTicketCaps(userId: string): Promise<void> {
  const [open] = await db
    .select({ value: count() })
    .from(schema.tickets)
    .where(
      and(
        eq(schema.tickets.openedById, userId),
        eq(schema.tickets.status, 'open')
      )
    );
  if ((open?.value ?? 0) >= MAX_OPEN_PER_MEMBER) {
    throw createError({
      statusCode: 429,
      message: `You already have ${MAX_OPEN_PER_MEMBER} open tickets — one of them has to be closed first`,
    });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [today] = await db
    .select({ value: count() })
    .from(schema.tickets)
    .where(
      and(
        eq(schema.tickets.openedById, userId),
        gte(schema.tickets.createdAt, since)
      )
    );
  if ((today?.value ?? 0) >= MAX_PER_DAY) {
    throw createError({
      statusCode: 429,
      message: `At most ${MAX_PER_DAY} tickets a day`,
    });
  }
}

/**
 * The ticket, if this caller may see it at all.
 *
 * Staff see every ticket — that is what "addressed to the staff" means.
 * A member sees theirs and nothing else, and gets 404 rather than 403 for
 * anyone else's: a ticket id must not be a way to learn that a ticket
 * exists.
 */
export async function ticketFor(
  id: string,
  viewer: { id: string; isAdmin?: boolean; isModerator?: boolean }
) {
  // Against the LIVE role, not the sealed cookie. This is the surface
  // where reading the cookie is wrong in both directions at once: a
  // moderator promoted after they signed in could open the queue (which
  // goes through `requireModeratorSession`, which reconciles) and then
  // get 404 trying to answer anything in it, while a demoted one kept
  // read access to every member's ticket for the seven days their
  // session lived.
  await reconcileStaffRoles(viewer);

  const ticket = await db.query.tickets.findFirst({
    where: eq(schema.tickets.id, id),
  });
  if (!ticket) return null;
  const isStaff = !!viewer.isAdmin || !!viewer.isModerator;
  if (!isStaff && ticket.openedById !== viewer.id) return null;
  return ticket;
}

/** Every line of it, oldest first — a ticket reads as a transcript. */
export async function ticketThread(ticketId: string) {
  return db
    .select({
      id: schema.ticketMessages.id,
      authorId: schema.ticketMessages.authorId,
      authorName: schema.ticketMessages.authorName,
      fromStaff: schema.ticketMessages.fromStaff,
      body: schema.ticketMessages.body,
      createdAt: schema.ticketMessages.createdAt,
    })
    .from(schema.ticketMessages)
    .where(eq(schema.ticketMessages.ticketId, ticketId))
    .orderBy(schema.ticketMessages.createdAt);
}
