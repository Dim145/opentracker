import { db, schema } from '@trackarr/db';
import { getStats } from '~~/utils/server';
import { desc, eq, ilike, sql, and, or, inArray, notInArray, isNull } from 'drizzle-orm';
import { validateQuery, torrentQuerySchema } from '~~/utils/schemas';
import { slugifyTag } from '~~/utils/tags';
import { normalizeMediaId, tmdbIdBare } from '~~/utils/mediaIds';
import { escapeLike } from '~~/utils/sql';
import { adultCategoryIds } from '~~/utils/adultContent';

export default defineEventHandler(async (event) => {
  // Require authentication
  const { user } = await requireUserSession(event);

  // Validate query parameters with Zod
  const query = validateQuery(event, torrentQuerySchema);

  const offset = (query.page - 1) * query.limit;

  // Check if user can see unapproved torrents
  const canSeeUnapproved = user.isAdmin || user.isModerator;

  // Refresh the adult preference from the row — the session is updated
  // lazily and we want the toggle to take effect on the very next page.
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { showAdultContent: true },
  });
  const showAdult = me?.showAdultContent ?? false;

  // Build where clause
  const conditions = [];

  // Only show approved torrents to regular users (but show their own pending)
  if (!canSeeUnapproved) {
    conditions.push(
      or(
        eq(schema.torrents.isApproved, true),
        eq(schema.torrents.uploaderId, user.id)
      )
    );
  }

  // Hide adult-categorised torrents from users who haven't opted in.
  // Uncategorised torrents (categoryId = null) are never adult so they
  // pass through unconditionally.
  if (!showAdult) {
    const adultIds = await adultCategoryIds();
    if (adultIds.length > 0) {
      conditions.push(
        or(
          isNull(schema.torrents.categoryId),
          notInArray(schema.torrents.categoryId, adultIds)
        )
      );
    }
  }

  if (query.search) {
    // Intelligent search: if it looks like an infoHash, search by it too
    const isHash = /^[0-9a-fA-F]{40}$/.test(query.search);
    if (isHash) {
      conditions.push(eq(schema.torrents.infoHash, query.search.toLowerCase()));
    } else {
      // Split search into terms for more flexible matching
      const terms = query.search.split(/\s+/).filter((t) => t.length > 0);
      if (terms.length > 0) {
        conditions.push(
          and(
            ...terms.map((term) =>
              ilike(schema.torrents.name, `%${escapeLike(term)}%`)
            )
          )
        );
      }
    }
  }
  if (query.categoryId) {
    // add category and subcategories filter
    const subcategories = await db.query.categories.findMany({
      where: eq(schema.categories.parentId, query.categoryId),
      select: { id: true },
    });
    conditions.push(
      or(
          eq(schema.torrents.categoryId, query.categoryId),
          ...subcategories.map((subcat) => eq(schema.torrents.categoryId, subcat.id))
      )
    );
  }

  // External media-id filters. Mirror the Torznab handler so a user
  // pasting an IMDb URL into the search bar finds the same torrents
  // Sonarr/Radarr would. Unparseable input → `WHERE false` rather
  // than silently widening to "ignore the filter".
  if (query.imdbid) {
    const norm = normalizeMediaId('imdb', query.imdbid);
    conditions.push(norm ? eq(schema.torrents.imdbId, norm) : sql`false`);
  }
  if (query.tmdbid) {
    // Stored TMDb id may carry a `tv/` or `movie/` prefix; bare query
    // values must still match. Same pattern as the Torznab handler.
    const norm = normalizeMediaId('tmdb', query.tmdbid);
    const bare = norm ? tmdbIdBare(norm) : null;
    if (norm && bare) {
      conditions.push(
        or(
          eq(schema.torrents.tmdbId, norm),
          eq(schema.torrents.tmdbId, bare),
          eq(schema.torrents.tmdbId, `movie/${bare}`),
          eq(schema.torrents.tmdbId, `tv/${bare}`)
        )!
      );
    } else {
      conditions.push(sql`false`);
    }
  }
  if (query.tvdbid) {
    const norm = normalizeMediaId('tvdb', query.tvdbid);
    conditions.push(norm ? eq(schema.torrents.tvdbId, norm) : sql`false`);
  }

  // Tag filter — `?tag=fhd,bluray` returns torrents that carry every tag in
  // the list (AND semantics, matching how a user thinks: "show me torrents
  // that are FHD AND Blu-Ray"). Resolves both names and slugs so the URL
  // stays readable while the autocomplete can keep submitting whatever the
  // user typed.
  if (query.tag) {
    const slugs = Array.from(
      new Set(
        query.tag
          .split(',')
          .map((s) => slugifyTag(s))
          .filter(Boolean)
      )
    );
    if (slugs.length > 0) {
      const matchedTags = await db.query.tags.findMany({
        where: inArray(schema.tags.slug, slugs),
        columns: { id: true },
      });
      // If any requested slug doesn't exist, no torrent can carry it →
      // honest empty result instead of widening to "ignore the filter".
      if (matchedTags.length !== slugs.length) {
        conditions.push(sql`false`);
      } else {
        const tagIds = matchedTags.map((t) => t.id);
        // Sub-select: torrent_id matches every requested tag id. Use
        // `count(distinct tag_id)` so the predicate stays correct
        // regardless of any future de-normalisation in torrent_tags.
        conditions.push(
          inArray(
            schema.torrents.id,
            db
              .select({ torrentId: schema.torrentTags.torrentId })
              .from(schema.torrentTags)
              .where(inArray(schema.torrentTags.tagId, tagIds))
              .groupBy(schema.torrentTags.torrentId)
              .having(
                sql`count(distinct ${schema.torrentTags.tagId}) = ${tagIds.length}`
              )
          )
        );
      }
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get torrents with optional search
  const torrents = await db.query.torrents.findMany({
    where: whereClause,
    with: {
      category: true,
      torrentTags: { with: { tag: true } },
    },
    orderBy: [desc(schema.torrents.createdAt)],
    limit: query.limit,
    offset,
  });

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.torrents)
    .where(whereClause);

  const total = countResult[0]?.count || 0;

  // Enrich with live stats from Redis. Tolerate partial failure: a Redis hiccup
  // for one torrent should not fail the whole listing — fall back to zeroes.
  const settled = await Promise.allSettled(
    torrents.map((t) => getStats(t.infoHash))
  );
  const enriched = torrents.map((torrent, i) => {
    const r = settled[i];
    const stats =
      r.status === 'fulfilled'
        ? r.value
        : { seeders: 0, leechers: 0, completed: 0 };
    const tags = torrent.torrentTags?.map((tt) => tt.tag) ?? [];
    return {
      ...torrent,
      torrentTags: undefined, // collapse the junction-table noise
      tags,
      stats: {
        seeders: stats.seeders,
        leechers: stats.leechers,
        completed: stats.completed,
      },
    };
  });

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
