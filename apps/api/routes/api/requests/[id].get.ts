/**
 * GET /api/requests/:id
 *
 * Single bounty + denormalised header (requester, category,
 * filler, filled torrent) + comments thread + the caller's
 * remaining proposal quota.
 *
 * The detail page needs all of these in one round-trip so the
 * action buttons (fill / cancel / validate / reject) can resolve
 * permissions without N follow-up queries.
 */
import { db, schema } from '@trackarr/db';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getRequestMaxFillsPerUser } from '~~/utils/settings';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const { id } = paramsSchema.parse(getRouterParams(event));

  const row = await db.query.uploadRequests.findFirst({
    where: eq(schema.uploadRequests.id, id),
  });
  if (!row) {
    throw createError({ statusCode: 404, message: 'Request not found' });
  }

  // Pull the surrounding rows in parallel. The requester always
  // exists (FK cascade); the filler + torrent + category are
  // optional and can be null.
  //
  // `fillAttempts` is the full audit trail of who proposed what,
  // when, and how it resolved (proposed / rejected / validated).
  // The detail page renders these in the timeline so a rejected
  // proposal doesn't vanish — it becomes a historical line.
  const [
    requester,
    category,
    filler,
    torrent,
    comments,
    attemptCount,
    fillAttempts,
  ] = await Promise.all([
    db.query.users.findFirst({
      where: eq(schema.users.id, row.requesterId),
      columns: { id: true, username: true },
    }),
    db.query.categories.findFirst({
      where: eq(schema.categories.id, row.categoryId),
      columns: {
        id: true,
        name: true,
        slug: true,
        type: true,
        icon: true,
      },
    }),
    row.filledById
      ? db.query.users.findFirst({
          where: eq(schema.users.id, row.filledById),
          columns: { id: true, username: true },
        })
      : Promise.resolve(null),
    row.filledTorrentId
      ? db.query.torrents.findFirst({
          where: eq(schema.torrents.id, row.filledTorrentId),
          columns: { id: true, infoHash: true, name: true },
        })
      : Promise.resolve(null),
    db.query.uploadRequestComments.findMany({
      where: eq(schema.uploadRequestComments.requestId, id),
      orderBy: (c, { asc }) => [asc(c.createdAt)],
    }),
    // Caller's own attempt count — drives the "you have N
    // attempts left" hint on the fill button.
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.uploadRequestFillAttempts)
      .where(
        and(
          eq(schema.uploadRequestFillAttempts.requestId, id),
          eq(schema.uploadRequestFillAttempts.userId, user.id),
        ),
      ),
    db.query.uploadRequestFillAttempts.findMany({
      where: eq(schema.uploadRequestFillAttempts.requestId, id),
      orderBy: (a, { asc }) => [asc(a.createdAt)],
    }),
  ]);

  // Resolve filler usernames for the timeline rows. The IDs come
  // from fill_attempts; rejected attempts may reference users who
  // since deleted their account (FK on delete cascade clears the
  // row, but the audit might still carry the id at read-time
  // depending on race) — defensive map lookup keeps the timeline
  // renderable either way.
  const fillUserIds = Array.from(
    new Set(fillAttempts.map((a) => a.userId)),
  );
  const fillUsers =
    fillUserIds.length === 0
      ? []
      : await db.query.users.findMany({
          where: (u, { inArray }) => inArray(u.id, fillUserIds),
          columns: { id: true, username: true },
        });
  const fillUserById = new Map(fillUsers.map((u) => [u.id, u]));

  // Resolve comment authors in one bulk lookup. Authors stay even
  // when the user account is deleted (FK on delete set null), so
  // we render "[deleted]" rather than crashing the thread.
  const authorIds = Array.from(
    new Set(
      comments
        .map((c) => c.authorId)
        .filter((v): v is string => v !== null),
    ),
  );
  const authors =
    authorIds.length === 0
      ? []
      : await db.query.users.findMany({
          where: (u, { inArray }) => inArray(u.id, authorIds),
          columns: { id: true, username: true },
        });
  const authorById = new Map(authors.map((a) => [a.id, a]));

  const maxFills = await getRequestMaxFillsPerUser();
  const callerAttempts = attemptCount[0]?.value ?? 0;

  // Discussion is closed once the request resolves — validated
  // and cancelled rows turn read-only so the thread doesn't keep
  // accumulating noise after the case is settled.
  const isClosed = row.status === 'validated' || row.status === 'cancelled';

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    rewardPoints: row.rewardPoints,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    filledAt: row.filledAt,
    validatedAt: row.validatedAt,
    cancelledAt: row.cancelledAt,
    requester: requester ?? null,
    category: category ?? null,
    filler: filler ?? null,
    torrent: torrent ?? null,
    comments: comments.map((c) => ({
      id: c.id,
      body: c.deletedAt ? null : c.body,
      createdAt: c.createdAt,
      editedAt: c.editedAt,
      deletedAt: c.deletedAt,
      author: c.authorId
        ? authorById.get(c.authorId) ?? null
        : null,
    })),
    // Historical record of every proposal — proposed, rejected,
    // validated. The detail page lays these out as the heartbeat
    // of the request alongside the four canonical state stamps.
    fillAttempts: fillAttempts.map((a) => ({
      id: a.id,
      status: a.status,
      createdAt: a.createdAt,
      rejectedAt: a.rejectedAt,
      user: fillUserById.get(a.userId) ?? null,
    })),
    viewer: {
      isRequester: row.requesterId === user.id,
      isFiller: row.filledById === user.id,
      isStaff: !!(user.isAdmin || user.isModerator),
      attempts: callerAttempts,
      maxAttempts: maxFills,
      attemptsLeft: Math.max(0, maxFills - callerAttempts),
      canComment: !isClosed,
    },
  };
});
