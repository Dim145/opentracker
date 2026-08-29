/**
 * GET /api/messaging/catch-up?since=<iso>
 *
 * What arrived while the stream was down.
 *
 * Valkey pub/sub keeps nothing, so a three-second reconnection leaves a
 * **silent** hole in the thread — the classic defect of a messaging system
 * built on pub/sub, and one that never shows up in development because the
 * connection never drops there. This is the repair, and it is also what
 * makes it safe for the relay to close a slow reader instead of feeding
 * it: the cut is repairable by construction.
 *
 * Bounded on purpose. Past the cap the answer is "reload" rather than a
 * larger page: a node dying means every client it held asks for catch-up
 * at the same moment, and an unbounded query is the one you just
 * multiplied by a node's worth of readers.
 */
import { db, schema } from '@trackarr/db';
import { and, asc, eq, gt, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateQuery } from '~~/utils/schemas';
import { requireDmAccess } from '~~/utils/messaging/guard';

/** Enough for a short blip; past it, refetching the thread is cheaper. */
const MAX_CATCH_UP = 100;
/** Nothing older than this: a client away for a day should just reload. */
const MAX_LOOKBACK_MS = 60 * 60 * 1000;

const querySchema = z.object({ since: z.coerce.date() });

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.public);

  const { since } = validateQuery(event, querySchema);
  const floor = new Date(Date.now() - MAX_LOOKBACK_MS);
  if (since < floor) {
    // Too far back to be worth a query. Saying so is better than serving a
    // truncated window the client would mistake for the whole gap.
    return { messages: [], truncated: true, reason: 'too-old' };
  }

  const mine = await db
    .select({ id: schema.conversationParticipants.conversationId })
    .from(schema.conversationParticipants)
    .where(
      and(
        eq(schema.conversationParticipants.userId, user.id),
        ne(schema.conversationParticipants.state, 'blocked')
      )
    );
  if (mine.length === 0) return { messages: [], truncated: false };

  const rows = await db
    .select({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      authorId: schema.messages.authorId,
      body: schema.messages.body,
      cipher: schema.messages.cipher,
      iv: schema.messages.iv,
      createdAt: schema.messages.createdAt,
      deletedAt: schema.messages.deletedAt,
    })
    .from(schema.messages)
    .where(
      and(
        inArray(
          schema.messages.conversationId,
          mine.map((m) => m.id)
        ),
        gt(schema.messages.createdAt, since)
      )
    )
    .orderBy(asc(schema.messages.createdAt))
    // One more than the cap, so a full page is distinguishable from a page
    // that happened to land exactly on it.
    .limit(MAX_CATCH_UP + 1);

  const truncated = rows.length > MAX_CATCH_UP;
  return {
    truncated,
    messages: (truncated ? rows.slice(0, MAX_CATCH_UP) : rows).map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      authorId: row.authorId,
      body: row.deletedAt ? null : row.body,
      cipher: row.deletedAt ? null : (row.cipher?.toString('base64') ?? null),
      iv: row.deletedAt ? null : (row.iv?.toString('base64') ?? null),
      createdAt: row.createdAt,
    })),
  };
});
