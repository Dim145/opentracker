/**
 * GET /api/me/following
 *
 * The caller's outgoing follow graph — the list of users they
 * subscribe to. Strictly private: this is the *only* endpoint that
 * surfaces follower identities, and it's keyed on the caller's own
 * session so a user can never enumerate someone else's follows.
 *
 * Each row is enriched with the followed user's uploads count, an
 * "last sighting" timestamp (the most recent accepted upload they
 * made), and their last-seen timestamp so the /following page can
 * render presence + activity glyphs without N round-trips.
 *
 * Default sort: most-recently-followed first. `sort=alpha` flips
 * to alphabetical for power users with crowded address books.
 */
import { db, schema } from '@trackarr/db';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  sort: z.enum(['recent', 'alpha']).default('recent'),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const query = querySchema.parse(getQuery(event));
  const offset = (query.page - 1) * query.limit;

  const orderClause =
    query.sort === 'alpha'
      ? [asc(schema.users.username)]
      : [desc(schema.userFollows.createdAt)];

  // Pull the followed users in one join. Drizzle's projection
  // shape here is flat (column aliases at the top level) — the
  // nested `{ user: { id, ... } }` form isn't supported, so we
  // flatten and rebuild the public shape after the query.
  const rows = await db
    .select({
      followedAt: schema.userFollows.createdAt,
      id: schema.users.id,
      username: schema.users.username,
      displayName: schema.users.displayName,
      bio: schema.users.bio,
      lastSeen: schema.users.lastSeen,
      memberSince: schema.users.createdAt,
      uploaded: schema.users.uploaded,
      downloaded: schema.users.downloaded,
    })
    .from(schema.userFollows)
    .innerJoin(
      schema.users,
      eq(schema.userFollows.followingId, schema.users.id),
    )
    .where(eq(schema.userFollows.followerId, user.id))
    .orderBy(...orderClause)
    .limit(query.limit)
    .offset(offset);

  const [{ value: total } = { value: 0 }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.userFollows)
    .where(eq(schema.userFollows.followerId, user.id));

  // Bulk-fetch each followed user's accepted upload count + most
  // recent accepted upload date. One grouped scan keyed on
  // uploader_id; results joined back on the JS side. Beats N
  // per-row lookups handily.
  let uploadStats = new Map<
    string,
    { uploadsCount: number; lastUploadAt: string | null }
  >();
  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const stats = await db
      .select({
        uploaderId: schema.torrents.uploaderId,
        uploadsCount: sql<number>`count(*)::int`,
        lastUploadAt: sql<string | null>`max(${schema.torrents.createdAt})`,
      })
      .from(schema.torrents)
      .where(
        and(
          eq(schema.torrents.moderationStatus, 'accepted'),
          inArray(schema.torrents.uploaderId, ids),
        ),
      )
      .groupBy(schema.torrents.uploaderId);
    uploadStats = new Map(
      stats
        .filter((s) => s.uploaderId !== null)
        .map((s) => [
          s.uploaderId as string,
          {
            uploadsCount: s.uploadsCount,
            lastUploadAt: s.lastUploadAt,
          },
        ]),
    );
  }

  const data = rows.map((r) => {
    const stats = uploadStats.get(r.id) ?? {
      uploadsCount: 0,
      lastUploadAt: null,
    };
    const ratio = r.downloaded > 0 ? r.uploaded / r.downloaded : null;
    return {
      id: r.id,
      username: r.username,
      displayName: r.displayName,
      bio: r.bio,
      memberSince: r.memberSince,
      lastSeen: r.lastSeen,
      ratio,
      uploadsCount: stats.uploadsCount,
      lastUploadAt: stats.lastUploadAt,
      followedAt: r.followedAt,
    };
  });

  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
    },
  };
});
