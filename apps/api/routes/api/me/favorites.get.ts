/**
 * GET /api/me/favorites
 *
 * Paginated list of the caller's favorited torrents.
 *
 * Output mirrors the public /api/torrents listing as much as
 * possible (same `stats`, `tags`, `category` shape) so the
 * `/me/favorites` page can reuse the same torrent-row rendering
 * if it ever needs to. Each row also carries `favoritedAt` so
 * the catalogue-card aesthetic can stamp a date on every entry.
 *
 * Default sort: most recently favorited first. `sort=name` and
 * `sort=seeders` give the user a way to flip the deck without
 * scrolling through 200 rows in time order.
 */
import { db, schema } from '@trackarr/db';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getStats } from '~~/utils/server';
import { validateQuery } from '~~/utils/schemas';
import { visibilityConditions } from '~~/utils/torrentListing';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  sort: z.enum(['recent', 'name', 'seeders']).default('recent'),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const query = validateQuery(event, querySchema);

  // Join through `torrent_favorites` so we get the pin timestamp
  // alongside the torrent row. Drizzle's `findMany` with a
  // relation doesn't expose the through-row's columns cleanly, so
  // we use the lower-level select API here.
  const offset = (query.page - 1) * query.limit;

  // Decide the ORDER BY clause before the query so we can swap it
  // without re-stating the join twice. `name` and `seeders`
  // ordering happens at the DB; live `seeders` comes from Redis
  // so we sort that one in-process after enrichment.
  const orderClause =
    query.sort === 'name'
      ? [asc(schema.torrents.name)]
      : [desc(schema.torrentFavorites.createdAt)];

  // A favorite outlives the torrent's visibility — rejected since, deactivated,
  // or adult content the member has since hidden — and this listing used to
  // serve it whatever it had become. Same conditions as the catalogue.
  const vis = await visibilityConditions({
    id: user.id,
    isAdmin: !!user.isAdmin,
    isModerator: !!user.isModerator,
  });
  const where = and(eq(schema.torrentFavorites.userId, user.id), ...vis);

  const rows = await db
    .select({
      // The columns the rows below are built from, not the whole row: that
      // carried the raw `.torrent` of every favorite.
      torrent: {
        id: schema.torrents.id,
        infoHash: schema.torrents.infoHash,
        name: schema.torrents.name,
        size: schema.torrents.size,
        createdAt: schema.torrents.createdAt,
        imdbId: schema.torrents.imdbId,
        tmdbId: schema.torrents.tmdbId,
        tvdbId: schema.torrents.tvdbId,
        igdbId: schema.torrents.igdbId,
        openlibraryId: schema.torrents.openlibraryId,
      },
      category: schema.categories,
      favoritedAt: schema.torrentFavorites.createdAt,
    })
    .from(schema.torrentFavorites)
    .innerJoin(
      schema.torrents,
      eq(schema.torrentFavorites.torrentId, schema.torrents.id),
    )
    .leftJoin(
      schema.categories,
      eq(schema.torrents.categoryId, schema.categories.id),
    )
    .where(where)
    .orderBy(...orderClause)
    .limit(query.limit)
    .offset(offset);

  const [{ value: total } = { value: 0 }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(schema.torrentFavorites)
    .innerJoin(schema.torrents, eq(schema.torrentFavorites.torrentId, schema.torrents.id))
    .where(where);

  // Enrich with Redis swarm stats. Tolerant of partial failure —
  // a missing key falls back to zeroes rather than torpedoing the
  // whole page (same approach the public listing uses).
  const settled = await Promise.allSettled(
    rows.map((r) => getStats(r.torrent.infoHash)),
  );
  let enriched = rows.map((r, i) => {
    const s = settled[i];
    const stats =
      s.status === 'fulfilled'
        ? s.value
        : { seeders: 0, leechers: 0, completed: 0 };
    return {
      id: r.torrent.id,
      infoHash: r.torrent.infoHash,
      name: r.torrent.name,
      size: r.torrent.size,
      createdAt: r.torrent.createdAt,
      imdbId: r.torrent.imdbId,
      tmdbId: r.torrent.tmdbId,
      tvdbId: r.torrent.tvdbId,
      igdbId: r.torrent.igdbId,
      openlibraryId: r.torrent.openlibraryId,
      category: r.category
        ? {
            id: r.category.id,
            name: r.category.name,
            slug: r.category.slug,
            type: r.category.type,
            icon: r.category.icon,
          }
        : null,
      stats: {
        seeders: stats.seeders,
        leechers: stats.leechers,
        completed: stats.completed,
      },
      favoritedAt: r.favoritedAt,
    };
  });

  // Apply the live-seeders sort here rather than at the DB.
  if (query.sort === 'seeders') {
    enriched = enriched.sort((a, b) => b.stats.seeders - a.stats.seeders);
  }

  return {
    data: enriched,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
    },
  };
});
