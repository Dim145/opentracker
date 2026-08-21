import { db, schema } from '@trackarr/db';
import { getStats } from '~~/utils/server';
import { eq, sql, and, or, inArray, notInArray, isNull, type SQL } from 'drizzle-orm';
import { validateQuery, torrentQuerySchema } from '~~/utils/schemas';
import { slugifyTag } from '~~/utils/tags';
import { normalizeMediaId, tmdbIdBare } from '~~/utils/mediaIds';
import { getSetting } from '~~/utils/settings';
import {
  FTS_CONFIG,
  SEARCH_FIELDS_SETTING,
  SEARCH_FUZZY_SETTING,
  ftsVector,
  fuzzyTerm,
  parseSearchFields,
  parseSearchFuzzy,
  toPrefixTsQuery,
} from '~~/utils/search';
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

  // Only show accepted torrents to regular users (but show their own
  // pending / changes_requested / rejected so they can find them in
  // their own listings even though they're hidden from the public
  // catalogue).
  if (!canSeeUnapproved) {
    conditions.push(
      or(
        eq(schema.torrents.moderationStatus, 'accepted'),
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

  // Free-text search. The infohash is handled upstream: it is an exact match
  // served by a unique index and has no business in the text path. IMDb / TMDb
  // / TVDB links never even reach here — the search bar detects them
  // client-side and sends them as dedicated parameters (see below).
  let searchCondition: SQL | null = null;
  let fuzzyFallback: SQL | null = null;
  if (query.search) {
    const isHash = /^[0-9a-fA-F]{40}$/.test(query.search);
    if (isHash) {
      searchCondition = eq(schema.torrents.infoHash, query.search.toLowerCase());
    } else {
      const fields = parseSearchFields(await getSetting(SEARCH_FIELDS_SETTING));
      const tsq = toPrefixTsQuery(query.search);
      if (tsq && fields.length) {
        const q = sql`to_tsquery(${FTS_CONFIG}, ${tsq})`;
        const branches: SQL[] = [];
        if (fields.includes('name')) {
          branches.push(sql`${ftsVector(schema.torrents.name)} @@ ${q}`);
        }
        if (fields.includes('description')) {
          branches.push(sql`${ftsVector(schema.torrents.description)} @@ ${q}`);
        }
        if (fields.includes('nfo')) {
          branches.push(sql`${ftsVector(schema.torrents.nfo)} @@ ${q}`);
        }
        if (fields.includes('tags')) {
          // A correlated EXISTS rather than a join: the join would duplicate
          // rows for a torrent carrying several matching tags, and would need a
          // DISTINCT that breaks pagination.
          branches.push(sql`EXISTS (
            SELECT 1 FROM ${schema.torrentTags} tt
            JOIN ${schema.tags} tg ON tg.id = tt.tag_id
            WHERE tt.torrent_id = ${schema.torrents.id}
              AND ${ftsVector(sql`tg.name`)} @@ ${q}
          )`);
        }
        searchCondition = branches.length > 1 ? or(...branches)! : branches[0]!;

        // Typo fallback, prepared here but only executed when the full-text
        // pass returns nothing: the trigram costs ten times more (237 ms
        // against 23 ms over 200,000 rows), which is only justified in the face
        // of an empty results page. `word_similarity`, not `similarity`: over a
        // whole release name the global similarity stays below the threshold
        // and never finds anything.
        const fuzzy = fuzzyTerm(query.search);
        if (fuzzy && parseSearchFuzzy(await getSetting(SEARCH_FUZZY_SETTING))) {
          fuzzyFallback = sql`${fuzzy} <% ${schema.torrents.name}`;
        }
      } else if (tsq) {
        // The operator disabled every field: text search returns nothing
        // rather than returning everything.
        searchCondition = sql`false`;
      }
    }
  }
  if (query.categoryId) {
    // add category and subcategories filter
    const subcategories = await db.query.categories.findMany({
      where: eq(schema.categories.parentId, query.categoryId),
      columns: { id: true },
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

  // The search predicate is kept apart from the filters, so the fuzzy fallback
  // replays the same query replacing only that.
  const compose = (search: SQL | null) => {
    const all = search ? [...conditions, search] : conditions;
    return all.length > 0 ? and(...all) : undefined;
  };
  const countRows = async (where: SQL | undefined) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.torrents)
      .where(where);
    return row?.count ?? 0;
  };

  let whereClause = compose(searchCondition);
  // The count is needed for pagination anyway: we do it first and it doubles
  // as the probe for the fallback. Probing separately would have added a query
  // to every single-word search, including the 95% that find their result
  // first time.
  let total = await countRows(whereClause);
  if (total === 0 && fuzzyFallback) {
    whereClause = compose(fuzzyFallback);
    total = await countRows(whereClause);
  }

  // Get torrents with optional search.
  //
  // Order: "most recently *made available*" rather than "most recently
  // uploaded". For auto-approved torrents the two timestamps are
  // identical (both are set to `now` in the upload handler), so the
  // ordering is unchanged for the common case. For torrents that sat
  // in the moderation queue for a while, the approval date is what the
  // user thinks of as "when this appeared on the tracker" — sorting by
  // upload date instead would bury a torrent that was just approved
  // simply because the moderator took their time.
  //
  // `COALESCE(moderated_at, created_at)` falls back to the upload
  // timestamp for rows where `moderated_at` is NULL (pending torrents
  // visible to their own uploader, plus everything visible to
  // admins/moderators), so the sort key is always defined.
  const torrents = await db.query.torrents.findMany({
    where: whereClause,
    // Negative projection: select every column EXCEPT the raw .torrent
    // blob. Without this drizzle pulls `torrent_data` (bytea) for every
    // row and Nitro serialises each as a {"type":"Buffer","data":[...]}
    // byte array ~4x its size — shipping the full file list + piece
    // hashes of every torrent to each member and turning a single
    // `?limit=100` into a multi-hundred-MB response (finding M4). Only
    // the gated download route reads torrent_data.
    columns: { torrentData: false },
    with: {
      category: true,
      torrentTags: { with: { tag: true } },
    },
    orderBy: [
      sql`COALESCE(${schema.torrents.moderatedAt}, ${schema.torrents.createdAt}) DESC`,
    ],
    limit: query.limit,
    offset,
  });

  // `total` was already computed above: it is what gates the fuzzy fallback.

  // Enrich with live stats from Redis. Tolerate partial failure: a Redis hiccup
  // for one torrent should not fail the whole listing — fall back to zeroes.
  const settled = await Promise.allSettled(
    torrents.map((t) => getStats(t.infoHash))
  );

  // Bulk-lookup the viewer's favorited torrent_ids among the page
  // slice — one indexed query for the whole page, then a `Set`
  // membership check per row when projecting. Keeps the star
  // toggle's filled/outline state authoritative without a
  // per-row round-trip.
  let favoritedSet = new Set<string>();
  if (torrents.length > 0) {
    const rows = await db
      .select({ torrentId: schema.torrentFavorites.torrentId })
      .from(schema.torrentFavorites)
      .where(
        and(
          eq(schema.torrentFavorites.userId, user.id),
          inArray(
            schema.torrentFavorites.torrentId,
            torrents.map((t) => t.id),
          ),
        ),
      );
    favoritedSet = new Set(rows.map((r) => r.torrentId));
  }

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
      viewerFavorited: favoritedSet.has(torrent.id),
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
