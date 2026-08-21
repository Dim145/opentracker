/**
 * GET /api/torrents/group?key=<group key>&scope=<scope>[&season=&episode=]
 *
 * One scope of one group: the skeleton a member navigates, plus the releases
 * of the bucket they are actually looking at.
 *
 * The key travels in a query parameter rather than a path segment because it
 * contains slashes (`tmdb:tv/1396`) and colons; encoding it into a path would
 * mean double-decoding on the way back, which is exactly the sort of thing
 * that quietly breaks behind a proxy.
 *
 * A key that parses to nothing renders an empty group rather than a 404: the
 * key is user-supplied text arriving from a URL, and a stale bookmark should
 * show "nothing here" rather than an error page.
 *
 * ## Why the response is a skeleton and not a tree
 *
 * A long-running series has more than a thousand episodes. Returning every
 * release of every episode would be megabytes for a row somebody clicked out
 * of curiosity, and rendering it would be a thousand DOM nodes per expanded
 * group on a page that holds twenty-five of them.
 *
 * So the shape is: the seasons, the episodes of ONE season, and the releases
 * of ONE episode. Everything else is a click away, and each click is a small
 * query. Which bucket opens by default is the one holding the newest release —
 * the same rule the collapsed row uses to pick its scope, applied one level
 * down.
 */
import { and, eq, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { adultCategoryIds } from '~~/utils/adultContent';
import { getStats } from '~~/utils/server';
import {
  GROUP_SCOPES,
  LIVE_AT,
  groupMemberWhere,
  parseGroupKey,
  scopeSql,
  scopeWhere,
  type GroupScope,
} from '~~/utils/torrentGroups';

const querySchema = z.object({
  key: z.string().trim().min(1).max(200),
  scope: z
    .enum(GROUP_SCOPES as unknown as [string, ...string[]])
    .default('all'),
  season: z.coerce.number().int().min(0).max(9_999).optional(),
  episode: z.coerce.number().int().min(0).max(9_999).optional(),
});

/**
 * Hard caps. Both are generous enough that no real work hits them, and low
 * enough that a pathological one cannot take the page down. When either bites
 * the response says so, because a silently short list reads as a hole in the
 * catalogue.
 */
const MAX_EPISODES = 300;
const MAX_RELEASES = 200;

interface BucketRow {
  season: number | null;
  episode: number | null;
  release_count: number;
  latest: string;
  seeders: number;
  /**
   * Distinct episodes under this season. Zero outside the episode scope, where
   * a season pack has no episodes to count.
   */
  episode_count: number;
  /**
   * Read out of the names rather than from tags: tags need a join and are only
   * as complete as the uploader made them, whereas the resolution is in the
   * filename by scene convention. It is what lets a collapsed episode header
   * still answer "is there a 4K in here".
   */
  resolutions: string[] | null;
}

/** The five tiers a release name is expected to declare. */
const RES = sql`substring(${schema.torrents.name} from '(2160p|1440p|1080p|720p|480p)')`;

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const query = await getValidatedQuery(event, querySchema.parse);
  const parsed = parseGroupKey(query.key);
  const scope = query.scope as GroupScope;

  const conditions: SQL[] = [groupMemberWhere(parsed)];

  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { showAdultContent: true },
  });
  if (!me?.showAdultContent) {
    const adultIds = await adultCategoryIds();
    if (adultIds.length > 0) {
      conditions.push(
        or(
          isNull(schema.torrents.categoryId),
          notInArray(schema.torrents.categoryId, adultIds),
        )!,
      );
    }
  }

  const base = and(...conditions)!;
  const inScope = scopeWhere(base, scope);
  const stats = schema.torrentStats;

  // The scopes this group offers. The listing row already has them from
  // `listGroups`, but the dedicated page is reached by URL and has no listing
  // behind it — and over a single group this is one indexed aggregate.
  const [scopeRow] = (await db.execute<{
    ep_units: number; ep_latest: string | null;
    season_units: number; season_latest: string | null;
    integral_units: number; integral_latest: string | null;
    all_units: number; all_latest: string | null;
    release_count: number;
    min_size: string; max_size: string;
    lead_name: string; category_ids: string[] | null;
  }>(sql`
    SELECT count(*)::int AS release_count,
           min(${schema.torrents.size}) AS min_size,
           max(${schema.torrents.size}) AS max_size,
           (array_agg(${schema.torrents.name}
                      ORDER BY ${schema.torrents.size} DESC))[1] AS lead_name,
           array_remove(array_agg(DISTINCT ${schema.torrents.categoryId}), NULL) AS category_ids,
           count(DISTINCT (${schema.torrents.season}, ${schema.torrents.episode}))
             FILTER (WHERE (${scopeSql}) = 'episode')::int AS ep_units,
           max(${LIVE_AT}) FILTER (WHERE (${scopeSql}) = 'episode') AS ep_latest,
           count(DISTINCT ${schema.torrents.season})
             FILTER (WHERE (${scopeSql}) = 'season')::int AS season_units,
           max(${LIVE_AT}) FILTER (WHERE (${scopeSql}) = 'season') AS season_latest,
           count(*) FILTER (WHERE (${scopeSql}) = 'integral')::int AS integral_units,
           max(${LIVE_AT}) FILTER (WHERE (${scopeSql}) = 'integral') AS integral_latest,
           count(*) FILTER (WHERE (${scopeSql}) = 'all')::int AS all_units,
           max(${LIVE_AT}) FILTER (WHERE (${scopeSql}) = 'all') AS all_latest
      FROM ${schema.torrents}
     WHERE ${base}
  `)) as unknown as Array<Record<string, unknown>>;

  const scopes = (
    [
      ['episode', scopeRow?.ep_units, scopeRow?.ep_latest],
      ['season', scopeRow?.season_units, scopeRow?.season_latest],
      ['integral', scopeRow?.integral_units, scopeRow?.integral_latest],
      ['all', scopeRow?.all_units, scopeRow?.all_latest],
    ] as Array<[GroupScope, unknown, unknown]>
  )
    .filter(([, units, latest]) => Number(units) > 0 && latest)
    .map(([s, units, latest]) => ({
      scope: s,
      units: Number(units),
      latest: new Date(latest as string),
    }));

  // ── Seasons ────────────────────────────────────────────────────────────
  // Only the two scopes that have them. `seeders` comes from the snapshot,
  // not from Redis: it labels a header the member has not opened yet, and
  // one Redis read per release of every season would defeat the point of
  // returning a skeleton.
  const seasonRows =
    scope === 'episode' || scope === 'season'
      ? ((await db.execute<BucketRow>(sql`
          SELECT ${schema.torrents.season} AS season,
                 NULL::smallint AS episode,
                 count(*)::int AS release_count,
                 count(DISTINCT ${schema.torrents.episode})::int AS episode_count,
                 max(${LIVE_AT}) AS latest,
                 coalesce(sum(${stats.seeders}), 0)::int AS seeders,
                 array_remove(array_agg(DISTINCT ${RES}), NULL) AS resolutions
            FROM ${schema.torrents}
            LEFT JOIN ${stats} ON ${stats.infoHash} = ${schema.torrents.infoHash}
           WHERE ${inScope}
           GROUP BY 1
           ORDER BY 1
        `)) as unknown as BucketRow[])
      : [];

  const seasons = seasonRows.map((r) => ({
    season: r.season == null ? null : Number(r.season),
    releaseCount: Number(r.release_count),
    episodeCount: Number(r.episode_count),
    latest: r.latest,
    seeders: Number(r.seeders),
    resolutions: r.resolutions ?? [],
  }));

  /** Newest wins, at every level. */
  function newest<T extends { latest: string }>(rows: T[]): T | undefined {
    let best: T | undefined;
    for (const r of rows) if (!best || r.latest > best.latest) best = r;
    return best;
  }

  const openSeason =
    seasons.length === 0
      ? null
      : query.season != null &&
          seasons.some((s) => s.season === query.season)
        ? query.season
        : (newest(seasons)?.season ?? null);

  // ── Episodes of the open season ────────────────────────────────────────
  let episodes: Array<{
    episode: number | null;
    releaseCount: number;
    latest: string;
    seeders: number;
    resolutions: string[];
  }> = [];
  let episodesTruncated = false;

  if (scope === 'episode' && openSeason != null) {
    const rows = (await db.execute<BucketRow>(sql`
      SELECT NULL::smallint AS season,
             ${schema.torrents.episode} AS episode,
             count(*)::int AS release_count,
             0 AS episode_count,
             max(${LIVE_AT}) AS latest,
             coalesce(sum(${stats.seeders}), 0)::int AS seeders,
             array_remove(array_agg(DISTINCT ${RES}), NULL) AS resolutions
        FROM ${schema.torrents}
        LEFT JOIN ${stats} ON ${stats.infoHash} = ${schema.torrents.infoHash}
       WHERE ${scopeWhere(base, scope, { season: openSeason })}
       -- 2, not 1: the first select column is the NULL placeholder that keeps
       -- this row shape identical to the season query's.
       GROUP BY 2
       -- Highest first so the cap, when it bites, keeps the episodes that
       -- just aired rather than the first three hundred of a decade-long run.
       ORDER BY 2 DESC
       LIMIT ${MAX_EPISODES + 1}
    `)) as unknown as BucketRow[];

    episodesTruncated = rows.length > MAX_EPISODES;
    episodes = rows
      .slice(0, MAX_EPISODES)
      .map((r) => ({
        episode: r.episode == null ? null : Number(r.episode),
        releaseCount: Number(r.release_count),
        latest: r.latest,
        seeders: Number(r.seeders),
        resolutions: r.resolutions ?? [],
      }))
      .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
  }

  const openEpisode =
    episodes.length === 0
      ? null
      : query.episode != null &&
          episodes.some((e) => e.episode === query.episode)
        ? query.episode
        : (newest(episodes)?.episode ?? null);

  // ── Releases of the open bucket ────────────────────────────────────────
  const bucket =
    scope === 'episode'
      ? { season: openSeason, episode: openEpisode }
      : scope === 'season'
        ? { season: openSeason }
        : undefined;

  const rows = await db.query.torrents.findMany({
    where: scopeWhere(base, scope, bucket),
    // Never the raw blob: it is a bytea Nitro would serialise as a byte array
    // roughly four times its size, for every release on the page.
    columns: { torrentData: false },
    orderBy: [sql`${schema.torrents.size} DESC`],
    limit: MAX_RELEASES + 1,
  });

  const releasesTruncated = rows.length > MAX_RELEASES;
  const page = rows.slice(0, MAX_RELEASES);

  // Live counts, and only here: this is a handful of releases, and it is the
  // one place the numbers drive a decision — which of these do I grab.
  const live = await Promise.allSettled(page.map((t) => getStats(t.infoHash)));

  return {
    group: {
      key: query.key,
      source: parsed.source,
      externalId: parsed.externalId,
      releaseCount: Number(scopeRow?.release_count ?? 0),
      minSize: Number(scopeRow?.min_size ?? 0),
      maxSize: Number(scopeRow?.max_size ?? 0),
      leadName: (scopeRow?.lead_name as string) ?? query.key,
      categoryIds: (scopeRow?.category_ids as string[] | null) ?? [],
      scopes,
      // Newest wins, the same rule the listing row uses to pick its chip.
      defaultScope:
        scopes.reduce<(typeof scopes)[number] | undefined>(
          (best, s) => (!best || s.latest > best.latest ? s : best),
          undefined,
        )?.scope ?? 'all',
    },
    scope,
    seasons,
    openSeason,
    episodes,
    episodesTruncated,
    openEpisode,
    releases: page.map((t, i) => {
      const s = live[i];
      const swarm =
        s?.status === 'fulfilled'
          ? { seeders: s.value.seeders ?? 0, leechers: s.value.leechers ?? 0 }
          : { seeders: 0, leechers: 0 };
      return {
        id: t.id,
        infoHash: t.infoHash,
        name: t.name,
        size: t.size,
        season: t.season,
        episode: t.episode,
        categoryId: t.categoryId,
        createdAt: t.createdAt,
        moderatedAt: t.moderatedAt,
        ...swarm,
      };
    }),
    releasesTruncated,
  };
});
