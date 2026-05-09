/**
 * Torznab API - Main Router
 * GET /api/torznab?t={function}&apikey={passkey}&...
 *
 * Handles all Torznab functions:
 * - caps: Capabilities
 * - search: General search
 * - tvsearch: TV-specific search
 * - movie: Movie-specific search
 */

import type { H3Event } from 'h3';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { getStats } from '~~/utils/server';
import { desc, eq, ilike, and, or, inArray, notInArray, isNull, sql } from 'drizzle-orm';
import { authenticateTorznab, sendTorznabError } from '../utils/auth';
import {
  buildCapsXml,
  buildSearchXml,
  TORZNAB_ERRORS,
  type TorznabItem,
} from '../utils/xml';
import {
  buildCategoryTree,
  filterCategoriesByNewznab,
  getNewznabCategoryId,
} from '../utils/categories';
import { rateLimit, getClientIP } from '~~/utils/rateLimit';
import {
  getTorznabEnabled,
  getTorznabRateLimitOptions,
  getTorznabEnableLogging,
} from '~~/utils/torznabSettings';
import {
  logTorznabRequest,
  isTorznabUserBlocked,
  trackRateLimitHit,
} from '~~/utils/torznabStats';
import { normalizeMediaId, tmdbIdBare } from '~~/utils/mediaIds';
import { escapeLike } from '~~/utils/sql';
import { adultCategoryIds } from '~~/utils/adultContent';

// Query schema for Torznab requests
const torznabQuerySchema = z.object({
  t: z.string().default('search'),
  apikey: z.string().optional(),
  q: z.string().optional(),
  cat: z.string().optional(), // Comma-separated category IDs
  limit: z.coerce.number().min(1).max(100).default(25),
  offset: z.coerce.number().min(0).default(0),
  // TV search params
  season: z.string().optional(),
  ep: z.string().optional(),
  tvdbid: z.string().optional(),
  // Movie / common search params (Sonarr+Radarr send these to match a
  // release against their library — see issue #47).
  imdbid: z.string().optional(),
  tmdbid: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const startTime = Date.now();

  // Check if Torznab API is enabled
  const enabled = await getTorznabEnabled();
  if (!enabled) {
    return sendTorznabError(event, {
      code: 900,
      description: 'Torznab API is currently disabled',
    });
  }

  // Parse query parameters
  const rawQuery = getQuery(event);
  const parseResult = torznabQuerySchema.safeParse(rawQuery);

  if (!parseResult.success) {
    return sendTorznabError(event, TORZNAB_ERRORS.INCORRECT_PARAMETER);
  }

  const query = parseResult.data;
  const func = query.t.toLowerCase();

  // Capabilities don't require authentication
  if (func === 'caps') {
    return handleCaps(event);
  }

  // All other functions require authentication
  // Wrap in try/catch to handle Torznab XML errors properly
  let user: { passkey: string };
  try {
    user = await authenticateTorznab(event);
  } catch (error: any) {
    // If it's a Torznab error, return the XML directly
    if (error.isTorznab && error.data) {
      setHeader(event, 'Content-Type', 'application/xml; charset=utf-8');
      setResponseStatus(event, error.statusCode || 400);
      return error.data;
    }
    throw error;
  }

  // Check if user is blocked from Torznab API
  const blockStatus = await isTorznabUserBlocked(user.passkey);
  if (blockStatus.blocked) {
    return sendTorznabError(
      event,
      TORZNAB_ERRORS.ACCOUNT_SUSPENDED,
      blockStatus.reason
    );
  }

  // Apply dynamic rate limiting based on settings
  const rateLimitOpts = await getTorznabRateLimitOptions('search');
  try {
    await rateLimit(event, rateLimitOpts);
  } catch (error: any) {
    if (error.statusCode === 429) {
      await trackRateLimitHit(user.passkey);
    }
    throw error;
  }

  let result: string;
  let errorMsg: string | undefined;
  // performSearch stores the row count it built into the response on
  // `event.context.torznabResultCount` so the request log records
  // how many items the user actually got — the previous code
  // initialised `resultCount = 0` and never incremented it.
  event.context.torznabResultCount = 0;

  try {
    switch (func) {
      case 'search':
        result = await handleSearch(event, query, user);
        break;
      case 'tvsearch':
        result = await handleTvSearch(event, query, user);
        break;
      case 'movie':
        result = await handleMovieSearch(event, query, user);
        break;
      default:
        return sendTorznabError(
          event,
          TORZNAB_ERRORS.NO_SUCH_FUNCTION,
          `Unknown function: ${func}`
        );
    }
  } catch (error: any) {
    errorMsg = error.message || 'Unknown error';
    throw error;
  } finally {
    // Log the request if logging is enabled
    const loggingEnabled = await getTorznabEnableLogging();
    if (loggingEnabled) {
      const responseTime = Date.now() - startTime;
      await logTorznabRequest({
        timestamp: Date.now(),
        passkey: user.passkey,
        function: func,
        query: query.q,
        ip: getClientIP(event),
        userAgent: getHeader(event, 'user-agent'),
        responseTime,
        resultCount: (event.context.torznabResultCount as number) ?? 0,
        error: errorMsg,
      });
    }
  }

  return result;
});

/**
 * Handle t=caps - Return capabilities
 */
async function handleCaps(event: H3Event) {
  const categories = await buildCategoryTree();

  const xml = buildCapsXml({
    serverVersion: '1.0',
    serverTitle: 'Trackarr',
    maxLimit: 100,
    defaultLimit: 25,
    categories,
  });

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8');
  setHeader(event, 'Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  return xml;
}

/**
 * Handle t=search - General search
 */
async function handleSearch(
  event: H3Event,
  query: z.infer<typeof torznabQuerySchema>,
  user: { passkey: string }
) {
  return performSearch(event, query, user);
}

/**
 * Handle t=tvsearch - TV-specific search
 * Supports season/episode parsing
 */
async function handleTvSearch(
  event: H3Event,
  query: z.infer<typeof torznabQuerySchema>,
  user: { passkey: string }
) {
  // Build search query with season/episode
  let searchQuery = query.q || '';

  if (query.season) {
    // Format: S01 or S1
    const seasonNum = parseInt(query.season, 10);
    if (!isNaN(seasonNum)) {
      const seasonStr = `S${seasonNum.toString().padStart(2, '0')}`;
      searchQuery += ` ${seasonStr}`;
    }
  }

  if (query.ep) {
    // Format: E01 or E1
    const epNum = parseInt(query.ep, 10);
    if (!isNaN(epNum)) {
      const epStr = `E${epNum.toString().padStart(2, '0')}`;
      searchQuery += epStr; // No space, directly after season
    }
  }

  // Force TV categories if none specified
  if (!query.cat) {
    query.cat = '5000'; // TV main category
  }

  return performSearch(event, { ...query, q: searchQuery.trim() }, user);
}

/**
 * Handle t=movie - Movie-specific search
 * Supports IMDB and TMDb ids — each is matched against the stored
 * torrent column directly, so a release with `imdbId=tt1234567` shows
 * up regardless of whether `tt1234567` appears in its title.
 */
async function handleMovieSearch(
  event: H3Event,
  query: z.infer<typeof torznabQuerySchema>,
  user: { passkey: string }
) {
  // Force Movie categories if none specified
  if (!query.cat) {
    query.cat = '2000'; // Movies main category
  }

  return performSearch(event, query, user);
}

/**
 * Perform the actual search and return Torznab XML
 */
async function performSearch(
  event: H3Event,
  query: z.infer<typeof torznabQuerySchema>,
  user: { passkey: string; showAdultContent: boolean }
) {
  const baseUrl = getRequestURL(event).origin;
  const conditions = [];

  // Only show active + accepted torrents — pending / changes-
  // requested / rejected rows never leak through Torznab feeds.
  conditions.push(eq(schema.torrents.isActive, true));
  conditions.push(eq(schema.torrents.moderationStatus, 'accepted'));

  // Hide adult-categorised torrents from accounts that haven't opted
  // in. *Arr clients submit the same `apikey=` for every search so the
  // toggle effectively scopes the whole feed.
  if (!user.showAdultContent) {
    const adultIds = await adultCategoryIds();
    if (adultIds.length > 0) {
      conditions.push(
        or(
          isNull(schema.torrents.categoryId),
          notInArray(schema.torrents.categoryId, adultIds)
        )!
      );
    }
  }

  // Text search
  if (query.q) {
    const terms = query.q.split(/\s+/).filter((t) => t.length > 0);
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

  // External media-database filters. *Arr clients send these on every
  // search to match a release against their library — answering with
  // unrelated torrents poisons their automation.
  if (query.imdbid) {
    const norm = normalizeMediaId('imdb', query.imdbid);
    conditions.push(
      norm ? eq(schema.torrents.imdbId, norm) : sql`false`
    );
  }
  if (query.tmdbid) {
    // Sonarr / Radarr send bare TMDb digits ("121361") but our column
    // may store either bare or a `tv/`/`movie/` prefixed form (an
    // operator can encode the type to disambiguate the two TMDb
    // namespaces). Match all three shapes against whatever's stored.
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
    conditions.push(
      norm ? eq(schema.torrents.tvdbId, norm) : sql`false`
    );
  }

  // Category filter
  if (query.cat) {
    const newznabIds = query.cat
      .split(',')
      .map((id) => parseInt(id.trim(), 10))
      .filter((id) => !isNaN(id));

    if (newznabIds.length > 0) {
      const trackarrCatIds = await filterCategoriesByNewznab(newznabIds);
      // Even when no Trackarr category matches the requested Newznab id we
      // must still apply a (deliberately empty) filter — otherwise an
      // unmatched `cat=` param silently widens to "all categories" and
      // returns torrents the consumer didn't ask for.
      conditions.push(
        trackarrCatIds.length > 0
          ? inArray(schema.torrents.categoryId, trackarrCatIds)
          : sql`false`
      );
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Fetch torrents
  const torrents = await db.query.torrents.findMany({
    where: whereClause,
    with: {
      category: true,
    },
    orderBy: [desc(schema.torrents.createdAt)],
    limit: query.limit,
    offset: query.offset,
  });

  // Enrich with stats from Redis
  const items: TorznabItem[] = await Promise.all(
    torrents.map(async (torrent) => {
      const stats = await getStats(torrent.infoHash);
      const newznabCatId = getNewznabCategoryId(torrent.category);

      return {
        title: torrent.name,
        guid: torrent.infoHash,
        link: `${baseUrl}/torrents/${torrent.infoHash}`,
        commentsUrl: `${baseUrl}/torrents/${torrent.infoHash}`,
        pubDate: new Date(torrent.createdAt),
        size: torrent.size,
        description: torrent.description ?? undefined,
        categoryName: torrent.category?.name,
        categoryId: newznabCatId,
        seeders: stats.seeders,
        leechers: stats.leechers,
        grabs: stats.completed,
        downloadUrl: `${baseUrl}/api/torznab/download?id=${torrent.infoHash}&apikey=${user.passkey}`,
        downloadVolumeFactor: 1, // Could be enhanced with freeleech support
        uploadVolumeFactor: 1,
        imdbId: torrent.imdbId ?? undefined,
        // Strip any `tv/` / `movie/` prefix before emitting — the
        // Torznab spec expects bare digits and *Arr clients won't
        // match against a prefixed value.
        tmdbId: tmdbIdBare(torrent.tmdbId) ?? undefined,
        tvdbId: torrent.tvdbId ?? undefined,
      };
    })
  );

  const xml = buildSearchXml({
    title: 'Trackarr',
    description: 'Trackarr Torznab Feed',
    link: baseUrl,
    selfUrl: `${baseUrl}/api/torznab`,
    items,
  });

  // Stash the row count for the request logger in the parent handler
  // (read in `finally`). Avoids changing the function's return type.
  event.context.torznabResultCount = items.length;

  setHeader(event, 'Content-Type', 'application/xml; charset=utf-8');
  return xml;
}
