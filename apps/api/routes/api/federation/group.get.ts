/**
 * GET /api/federation/group?key=&scope=[&season=&episode=] — authenticated, local.
 *
 * One scope of one federated group, in the same shape as
 * `/api/torrents/group`: the seasons, the episodes of one season, the releases
 * of one bucket. The front end renders both with the same component, so the two
 * catalogues navigate identically — which is the point of doing this at all.
 *
 * The one structural difference is that a release here can come from several
 * partners at once. It is returned ONCE, with the list of partners carrying it,
 * because "the same release on three instances" is one thing to download, not
 * three. Folding on the same key `/api/federation/browse` uses keeps the two
 * views honest with each other.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { sql, type SQL } from 'drizzle-orm';
import {
  GROUP_SCOPES,
  parseGroupKey,
  type GroupScope,
} from '~~/utils/torrentGroups';
import {
  RELEASE_KEY,
  REMOTE_LIVE_AT,
  remoteGroupWhere,
  remoteScopeSql,
} from '~~/utils/remoteGroups';

const rt = schema.remoteTorrents;
const peers = schema.federationPeers;

const querySchema = z.object({
  key: z.string().trim().min(1).max(200),
  scope: z.enum(GROUP_SCOPES as unknown as [string, ...string[]]).default('all'),
  season: z.coerce.number().int().min(0).max(9_999).optional(),
  episode: z.coerce.number().int().min(0).max(9_999).optional(),
});

/** Same caps as the local group endpoint, same reasons. */
const MAX_EPISODES = 300;
const MAX_RELEASES = 200;

const RES = sql`substring(${rt.name} from '(2160p|1440p|1080p|720p|480p)')`;

/** Narrow a mirror predicate to one scope, and optionally to one bucket. */
function scopeWhere(
  base: SQL,
  scope: GroupScope,
  bucket?: { season?: number | null; episode?: number | null },
): SQL {
  let out: SQL;
  switch (scope) {
    case 'episode':
      out = sql`${base} AND ${rt.season} IS NOT NULL AND ${rt.episode} IS NOT NULL`;
      break;
    case 'season':
      out = sql`${base} AND ${rt.season} IS NOT NULL AND ${rt.episode} IS NULL`;
      break;
    case 'integral':
      out = sql`${base} AND ${rt.season} IS NULL`;
      break;
    default:
      out = base;
  }
  if (bucket?.season != null) out = sql`${out} AND ${rt.season} = ${bucket.season}`;
  if (bucket?.episode != null) out = sql`${out} AND ${rt.episode} = ${bucket.episode}`;
  return out;
}

interface BucketRow {
  season: number | null;
  episode: number | null;
  release_count: number;
  episode_count: number;
  latest: string;
  seeders: number;
  resolutions: string[] | null;
}

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const query = await getValidatedQuery(event, querySchema.parse);
  const parsed = parseGroupKey(query.key);
  const scope = query.scope as GroupScope;

  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { showAdultContent: true },
  });
  const base = remoteGroupWhere(parsed, !!me?.showAdultContent);
  const join = sql`FROM ${rt} INNER JOIN ${peers} ON ${peers.id} = ${rt.peerId}`;

  // ── The scopes this group offers ───────────────────────────────────────
  const [scopeRow] = (await db.execute(sql`
    SELECT count(DISTINCT ${RELEASE_KEY})::int AS release_count,
           min(${rt.size}) AS min_size,
           max(${rt.size}) AS max_size,
           (array_agg(${rt.name} ORDER BY ${rt.size} DESC))[1] AS lead_name,
           array_remove(array_agg(DISTINCT ${rt.categorySlug}), NULL) AS category_slugs,
           count(DISTINCT (${rt.season}, ${rt.episode}))
             FILTER (WHERE (${remoteScopeSql}) = 'episode')::int AS ep_units,
           max(${REMOTE_LIVE_AT}) FILTER (WHERE (${remoteScopeSql}) = 'episode') AS ep_latest,
           count(DISTINCT ${rt.season})
             FILTER (WHERE (${remoteScopeSql}) = 'season')::int AS season_units,
           max(${REMOTE_LIVE_AT}) FILTER (WHERE (${remoteScopeSql}) = 'season') AS season_latest,
           count(DISTINCT ${RELEASE_KEY})
             FILTER (WHERE (${remoteScopeSql}) = 'integral')::int AS integral_units,
           max(${REMOTE_LIVE_AT}) FILTER (WHERE (${remoteScopeSql}) = 'integral') AS integral_latest,
           count(DISTINCT ${RELEASE_KEY})
             FILTER (WHERE (${remoteScopeSql}) = 'all')::int AS all_units,
           max(${REMOTE_LIVE_AT}) FILTER (WHERE (${remoteScopeSql}) = 'all') AS all_latest
      ${join} WHERE ${base}
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
  const seasonRows =
    scope === 'episode' || scope === 'season'
      ? ((await db.execute<BucketRow>(sql`
          SELECT ${rt.season} AS season,
                 NULL::smallint AS episode,
                 count(DISTINCT ${RELEASE_KEY})::int AS release_count,
                 count(DISTINCT ${rt.episode})::int AS episode_count,
                 max(${REMOTE_LIVE_AT}) AS latest,
                 coalesce(max(${rt.seeders}), 0)::int AS seeders,
                 array_remove(array_agg(DISTINCT ${RES}), NULL) AS resolutions
            ${join} WHERE ${scopeWhere(base, scope)}
           GROUP BY 1 ORDER BY 1
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

  function newest<T extends { latest: string }>(rows: T[]): T | undefined {
    let best: T | undefined;
    for (const r of rows) if (!best || r.latest > best.latest) best = r;
    return best;
  }

  const openSeason =
    seasons.length === 0
      ? null
      : query.season != null && seasons.some((s) => s.season === query.season)
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
             ${rt.episode} AS episode,
             count(DISTINCT ${RELEASE_KEY})::int AS release_count,
             0 AS episode_count,
             max(${REMOTE_LIVE_AT}) AS latest,
             coalesce(max(${rt.seeders}), 0)::int AS seeders,
             array_remove(array_agg(DISTINCT ${RES}), NULL) AS resolutions
        ${join} WHERE ${scopeWhere(base, scope, { season: openSeason })}
       GROUP BY 2 ORDER BY 2 DESC
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
      : query.episode != null && episodes.some((e) => e.episode === query.episode)
        ? query.episode
        : (newest(episodes)?.episode ?? null);

  // ── Releases of the open bucket, folded across partners ────────────────
  const bucket =
    scope === 'episode'
      ? { season: openSeason, episode: openEpisode }
      : scope === 'season'
        ? { season: openSeason }
        : undefined;

  interface ReleaseRow {
    release_key: string;
    id: string;
    info_hash: string;
    name: string;
    size: string;
    seeders: number;
    leechers: number;
    latest: string;
    detail_url: string | null;
    peer_names: string[] | null;
  }

  const rows = (await db.execute<ReleaseRow>(sql`
    SELECT ${RELEASE_KEY} AS release_key,
           -- One representative row per release: the best-seeded copy, since
           -- that is the one a member would take. The others contribute only
           -- their partner name.
           (array_agg(${rt.id} ORDER BY ${rt.seeders} DESC))[1] AS id,
           (array_agg(${rt.infoHash} ORDER BY ${rt.seeders} DESC))[1] AS info_hash,
           (array_agg(${rt.name} ORDER BY ${rt.seeders} DESC))[1] AS name,
           (array_agg(${rt.size} ORDER BY ${rt.seeders} DESC))[1] AS size,
           (array_agg(${rt.remoteDetailUrl} ORDER BY ${rt.seeders} DESC))[1] AS detail_url,
           max(${rt.seeders})::int AS seeders,
           max(${rt.leechers})::int AS leechers,
           max(${REMOTE_LIVE_AT}) AS latest,
           array_remove(array_agg(DISTINCT ${peers.displayName}), NULL) AS peer_names
      ${join} WHERE ${scopeWhere(base, scope, bucket)}
     GROUP BY 1
     ORDER BY max(${rt.size}) DESC
     LIMIT ${MAX_RELEASES + 1}
  `)) as unknown as ReleaseRow[];

  const releasesTruncated = rows.length > MAX_RELEASES;

  return {
    group: {
      key: query.key,
      source: parsed.source,
      externalId: parsed.externalId,
      releaseCount: Number(scopeRow?.release_count ?? 0),
      minSize: Number(scopeRow?.min_size ?? 0),
      maxSize: Number(scopeRow?.max_size ?? 0),
      leadName: (scopeRow?.lead_name as string) ?? query.key,
      categorySlugs: (scopeRow?.category_slugs as string[] | null) ?? [],
      scopes,
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
    releases: rows.slice(0, MAX_RELEASES).map((r) => ({
      id: r.id,
      infoHash: r.info_hash,
      name: r.name,
      size: Number(r.size),
      seeders: Number(r.seeders),
      leechers: Number(r.leechers),
      createdAt: r.latest,
      moderatedAt: null,
      // What makes this row federated: it goes home, and it carries no
      // download. The `.torrent` is fetched from the origin, with an account
      // there — never proxied with the local passkey.
      remote: { detailUrl: r.detail_url, peers: r.peer_names ?? [] },
    })),
    releasesTruncated,
  };
});
