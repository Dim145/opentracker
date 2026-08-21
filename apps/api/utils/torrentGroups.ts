/**
 * Server-side release grouping.
 *
 * Several releases of the same work — a 2160p remux, a 1080p WEB-DL, a 720p
 * BluRay — are one entry in the catalogue and several rows underneath it. The
 * listing page grouped for a while, but only within the rows it had already
 * fetched: the grouping did not survive pagination, could not carry a page of
 * its own, and aggregated nothing.
 *
 * ## What identifies a work
 *
 * The external metadata id, and only that. The content signature used for
 * cross-seed detection is the OPPOSITE axis — it hashes file paths and sizes,
 * so it recognises the same release copied around, and two different encodes
 * of one film never share it. Grouping on it would put nothing together.
 *
 * ## The group is the work; season and episode are navigation
 *
 * An earlier version put the season IN the key (`tmdb:tv/1396:s03`), which made
 * a three-season show three unrelated entries in the listing. A member looking
 * for a series wants the series, then chooses how deep to go. So the key is the
 * work, and everything below it is reached through a SCOPE:
 *
 *   - `episode`  — one release per episode      ("À l'épisode")
 *   - `season`   — a season pack                ("Saisons complètes")
 *   - `integral` — the whole series in one go   ("Intégrale")
 *
 * The scope is derived, not stored: `season` and `episode` are parsed at upload
 * and backfilled, and the three cases are exactly the three shapes those two
 * columns can take. A film, a game or a book has no such split and gets the
 * single scope `all`.
 *
 * This is the extra filter the flat listing never had: "show me the season
 * packs" is a question about how a release is cut, which no search term
 * expresses.
 *
 * ## Why the query is split in two
 *
 * `GROUP BY` over the whole table costs a sequential scan and a hash aggregate
 * on every page — 180 ms over 200 000 rows here, growing linearly, unable to
 * stop early because ordering groups by recency needs every group before it
 * can pick 25.
 *
 * But a torrent with no external id is a group of one and needs no aggregation
 * at all. Separating the two halves lets the untagged side stream off an index
 * and stop at the limit, leaving only genuinely foldable rows in the aggregate.
 *
 * The ceiling is worth stating: on a catalogue where nearly everything is
 * tagged, the aggregate is back to covering most of the table. That is the
 * point at which a persisted group entity stops being optional.
 */
import { sql, type Column, type SQL } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';

export type GroupSource = 'tmdb' | 'igdb' | 'openlibrary' | 'solo';

/**
 * How a release is cut. `all` is the degenerate scope of anything that is not
 * a television series — there is only one way to release a film.
 */
export type GroupScope = 'episode' | 'season' | 'integral' | 'all';

export const GROUP_SCOPES: readonly GroupScope[] = [
  'episode',
  'season',
  'integral',
  'all',
] as const;

export interface ParsedGroupKey {
  source: GroupSource;
  /** `tv/1396`, `movie/603`, an IGDB id, an OpenLibrary id, or a torrent id. */
  externalId: string;
}

/**
 * The columns a grouping reads, wherever they live.
 *
 * Two tables carry the same idea with different shapes: the local `torrents`
 * and the federated mirror `remote_torrents`. Rather than one query full of
 * conditionals, the two SHARE the expressions that define what a group is —
 * these builders — and each owns its own FROM, its own notion of visibility
 * and its own deduplication. That split is deliberate: the vocabulary must not
 * drift between local and remote, but the plumbing genuinely differs.
 */
export interface GroupColumns {
  igdbId: Column | SQL;
  openlibraryId: Column | SQL;
  tmdbId: Column | SQL;
  season: Column | SQL;
  episode: Column | SQL;
  /**
   * What a row with no external id groups on. Locally that is the torrent id —
   * an untagged torrent is a group of one. In the mirror it is the release key
   * (`content_signature` falling back to `info_hash`), so the same untagged
   * release seen on three partners is one group, not three.
   */
  soloKey: Column | SQL;
}

/**
 * The grouping key, as SQL.
 *
 * IGDB and OpenLibrary come first because they are set deliberately by the
 * uploader or by an explicit auto-detect, whereas a stale TMDb id can linger
 * on a row that has since been identified as a game or a book.
 */
export function groupKeyExpr(c: GroupColumns): SQL {
  return sql`
  CASE
    WHEN ${c.igdbId} IS NOT NULL THEN 'igdb:' || ${c.igdbId}
    WHEN ${c.openlibraryId} IS NOT NULL THEN 'openlibrary:' || ${c.openlibraryId}
    WHEN ${c.tmdbId} IS NOT NULL THEN 'tmdb:' || ${c.tmdbId}
    ELSE 'solo:' || ${c.soloKey}
  END`;
}

/**
 * The scope of one release, as SQL.
 *
 * Only a television row can be cut three ways; the check on `tmdb_id` is what
 * keeps a film that happens to carry a stray `season` out of the season scope.
 */
export function scopeExpr(c: GroupColumns): SQL {
  return sql`
  CASE
    WHEN ${c.igdbId} IS NOT NULL
      OR ${c.openlibraryId} IS NOT NULL
      OR ${c.tmdbId} IS NULL
      OR ${c.tmdbId} NOT LIKE 'tv/%'
      THEN 'all'
    WHEN ${c.season} IS NULL THEN 'integral'
    WHEN ${c.episode} IS NULL THEN 'season'
    ELSE 'episode'
  END`;
}

/** The local catalogue's columns. */
export const TORRENT_COLUMNS: GroupColumns = {
  igdbId: schema.torrents.igdbId,
  openlibraryId: schema.torrents.openlibraryId,
  tmdbId: schema.torrents.tmdbId,
  season: schema.torrents.season,
  episode: schema.torrents.episode,
  soloKey: schema.torrents.id,
};

export const groupKeySql: SQL = groupKeyExpr(TORRENT_COLUMNS);
export const scopeSql: SQL = scopeExpr(TORRENT_COLUMNS);

/** True for rows that can be folded with others. */
const TAGGED = sql`(${schema.torrents.tmdbId} IS NOT NULL
  OR ${schema.torrents.igdbId} IS NOT NULL
  OR ${schema.torrents.openlibraryId} IS NOT NULL)`;

const UNTAGGED = sql`(${schema.torrents.tmdbId} IS NULL
  AND ${schema.torrents.igdbId} IS NULL
  AND ${schema.torrents.openlibraryId} IS NULL)`;

export const VISIBLE = sql`${schema.torrents.moderationStatus} = 'accepted'
  AND ${schema.torrents.isActive}`;

/** `coalesce(moderated_at, created_at)` — when the release went live here. */
export const LIVE_AT = sql`coalesce(${schema.torrents.moderatedAt}, ${schema.torrents.createdAt})`;

/**
 * Split a key back into its parts. Total: an unrecognised prefix is reported
 * as `solo` rather than throwing, because the key travels through a URL and a
 * malformed one must render an empty page, not a 500.
 */
export function parseGroupKey(key: string): ParsedGroupKey {
  const colon = key.indexOf(':');
  if (colon === -1) return { source: 'solo', externalId: key };
  const prefix = key.slice(0, colon);
  const rest = key.slice(colon + 1);
  if (prefix === 'tmdb' || prefix === 'igdb' || prefix === 'openlibrary') {
    return { source: prefix, externalId: rest };
  }
  return { source: 'solo', externalId: rest };
}

/** One scope of a group, as the collapsed row advertises it. */
export interface ScopeSummary {
  scope: GroupScope;
  /**
   * How many UNITS the scope holds — episodes, seasons, or plain releases.
   * Not a release count: "À l'épisode (7)" means seven episodes exist, however
   * many encodes each of them has.
   */
  units: number;
  /** Newest release in the scope; this is what picks the default. */
  latest: Date;
}

export interface GroupRow {
  key: string;
  source: GroupSource;
  externalId: string;
  /** Number of releases the group holds — the count the UI shows. */
  releaseCount: number;
  /** Most recent availability across the group; the listing sorts on it. */
  latest: Date;
  /** Smallest and largest release, for the "1.4 – 64 GiB" span. */
  minSize: number;
  maxSize: number;
  /** Lead release's name, used as the heading until metadata is resolved. */
  leadName: string;
  categoryIds: string[];
  /**
   * Swarm range across the group, from the `torrent_stats` snapshot rather
   * than from Redis. Redis holds the live numbers, but one read per release
   * would be hundreds of round trips for a page of long-running series. The
   * snapshot is refreshed by the stats collector; the live numbers appear the
   * moment a scope is expanded, because those rows are few enough to ask
   * Redis for.
   */
  seedMin: number;
  seedMax: number;
  leechMin: number;
  leechMax: number;
  /** Non-empty scopes, richest first. Drives the chips on the row. */
  scopes: ScopeSummary[];
  /**
   * The scope to open when the row is expanded: the one holding the newest
   * release.
   *
   * The alternative was to ask TMDb whether the series is still running and
   * prefer episodes for a live show, packs for a finished one. Rejected: it
   * needs a network call per group, the answer is not in our database, and it
   * is wrong precisely when it matters — somebody uploading the integral of a
   * long-finished series wants that integral surfaced, and "returning series"
   * would bury it under episodes from two years ago. Newest-first needs
   * nothing, and says what is moving now.
   */
  defaultScope: GroupScope;
}

interface ListOptions {
  limit: number;
  offset: number;
  /** Extra predicates over `torrents`, already composed. */
  where?: SQL;
  /** Keep only groups holding at least one release cut this way. */
  scope?: GroupScope;
}

interface RawGroup extends RawScopeCounts {
  gkey: string;
  release_count: number;
  latest: string;
  min_size: string;
  max_size: string;
  lead_name: string;
  category_ids: string[] | null;
  seed_min: number | null;
  seed_max: number | null;
  leech_min: number | null;
  leech_max: number | null;
}

/**
 * The four `FILTER (WHERE scope = …)` pairs, as they come back from either
 * table. Named so the two queries cannot drift on the column names.
 */
export interface RawScopeCounts {
  ep_units: number;
  ep_latest: string | null;
  season_units: number;
  season_latest: string | null;
  integral_units: number;
  integral_latest: string | null;
  all_units: number;
  all_latest: string | null;
}

export function toScopes(r: RawScopeCounts): ScopeSummary[] {
  const raw: Array<[GroupScope, number, string | null]> = [
    ['episode', Number(r.ep_units), r.ep_latest],
    ['season', Number(r.season_units), r.season_latest],
    ['integral', Number(r.integral_units), r.integral_latest],
    ['all', Number(r.all_units), r.all_latest],
  ];
  return raw
    .filter(([, units, latest]) => units > 0 && latest)
    .map(([scope, units, latest]) => ({
      scope,
      units,
      latest: new Date(latest!),
    }));
}

/** The scope holding the newest release; `all` when the group has none. */
export function pickDefault(scopes: ScopeSummary[]): GroupScope {
  let best = scopes[0];
  for (const s of scopes) {
    if (!best || s.latest > best.latest) best = s;
  }
  return best?.scope ?? 'all';
}

/**
 * One page of groups, newest first.
 *
 * Deliberately carries no releases. The row is collapsed, and a member who
 * never expands it should not have paid for a fan-out of sample queries and
 * Redis reads across twenty-five groups. Expanding asks for one scope of one
 * group, which is the only moment the releases are worth fetching.
 */
export async function listGroups(
  opts: ListOptions,
): Promise<{ groups: GroupRow[]; total: number }> {
  const extra = opts.where ? sql` AND (${opts.where})` : sql``;
  // A scope filter is a predicate over the ROWS, so it composes with the rest:
  // a group survives when at least one of its releases is cut that way, which
  // is what filtering before the aggregate gives for free.
  const scoped = opts.scope ? sql` AND (${scopeSql}) = ${opts.scope}` : sql``;
  const filter = sql`${extra}${scoped}`;

  // An untagged torrent is a group of one, and it is always cut one way — it
  // carries no season, so its scope is `all` by construction. Any other scope
  // filter therefore excludes the whole half, which is worth saying up front
  // rather than making Postgres discover it row by row.
  const soloFilter =
    !opts.scope || opts.scope === 'all' ? extra : sql` AND false`;

  const stats = schema.torrentStats;
  const seeders = sql`coalesce(${stats.seeders}, 0)`;
  const leechers = sql`coalesce(${stats.leechers}, 0)`;

  // The two halves are separate queries over `torrents`, NOT two reads of a
  // shared CTE. A CTE here is an optimisation fence: Postgres materialises it,
  // which means scanning and joining all 200 000 rows before either half can
  // start — the untagged side then top-N sorts what it should have streamed
  // off an index and stopped at twenty-five. Measured: 3.7 ms split, 375 ms
  // shared.
  const rows = await db.execute<RawGroup>(sql`
    WITH grouped AS (
      SELECT ${groupKeySql} AS gkey,
             count(*)::int AS release_count,
             max(${LIVE_AT}) AS latest,
             min(${schema.torrents.size}) AS min_size,
             max(${schema.torrents.size}) AS max_size,
             (array_agg(${schema.torrents.name}
                        ORDER BY ${schema.torrents.size} DESC))[1] AS lead_name,
             array_remove(array_agg(DISTINCT ${schema.torrents.categoryId}), NULL) AS category_ids,
             min(${seeders})::int AS seed_min,
             max(${seeders})::int AS seed_max,
             min(${leechers})::int AS leech_min,
             max(${leechers})::int AS leech_max,
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
        LEFT JOIN ${stats} ON ${stats.infoHash} = ${schema.torrents.infoHash}
       WHERE ${VISIBLE} AND ${TAGGED}${filter}
       GROUP BY 1
    ), solo AS (
      SELECT ${groupKeySql} AS gkey,
             1 AS release_count,
             ${LIVE_AT} AS latest,
             ${schema.torrents.size} AS min_size,
             ${schema.torrents.size} AS max_size,
             ${schema.torrents.name} AS lead_name,
             array_remove(ARRAY[${schema.torrents.categoryId}], NULL) AS category_ids,
             ${seeders}::int AS seed_min, ${seeders}::int AS seed_max,
             ${leechers}::int AS leech_min, ${leechers}::int AS leech_max,
             0 AS ep_units, NULL::timestamp AS ep_latest,
             0 AS season_units, NULL::timestamp AS season_latest,
             0 AS integral_units, NULL::timestamp AS integral_latest,
             1 AS all_units, ${LIVE_AT} AS all_latest
        FROM ${schema.torrents}
        LEFT JOIN ${stats} ON ${stats.infoHash} = ${schema.torrents.infoHash}
       WHERE ${VISIBLE} AND ${UNTAGGED}${soloFilter}
       -- Matches torrents_ungrouped_idx expression for expression: this is
       -- the ordering the index already holds, which is what lets the scan
       -- stop at the limit instead of sorting the catalogue.
       ORDER BY ${LIVE_AT} DESC
       LIMIT ${opts.limit + opts.offset}
    )
    SELECT * FROM (SELECT * FROM grouped UNION ALL SELECT * FROM solo) u
     ORDER BY latest DESC
     LIMIT ${opts.limit} OFFSET ${opts.offset}
  `);

  const [countRow] = await db.execute<{ total: number }>(sql`
    SELECT (
      (SELECT count(DISTINCT ${groupKeySql})::int FROM ${schema.torrents}
        WHERE ${VISIBLE} AND ${TAGGED}${filter})
      +
      (SELECT count(*)::int FROM ${schema.torrents}
        WHERE ${VISIBLE} AND ${UNTAGGED}${soloFilter})
    ) AS total`);

  return {
    groups: (rows as unknown as RawGroup[]).map((r) => {
      const parsed = parseGroupKey(r.gkey);
      const scopes = toScopes(r);
      return {
        key: r.gkey,
        source: parsed.source,
        externalId: parsed.externalId,
        releaseCount: Number(r.release_count),
        latest: new Date(r.latest),
        minSize: Number(r.min_size),
        maxSize: Number(r.max_size),
        leadName: r.lead_name,
        categoryIds: r.category_ids ?? [],
        seedMin: Number(r.seed_min ?? 0),
        seedMax: Number(r.seed_max ?? 0),
        leechMin: Number(r.leech_min ?? 0),
        leechMax: Number(r.leech_max ?? 0),
        scopes,
        defaultScope: pickDefault(scopes),
      };
    }),
    total: Number((countRow as unknown as { total: number })?.total ?? 0),
  };
}

/**
 * The predicate that selects one group's releases.
 *
 * Rebuilt from the parsed parts rather than compared against the key
 * expression, so the planner can use the plain column indexes instead of
 * evaluating the CASE for every row.
 */
export function groupMemberWhere(parsed: ParsedGroupKey): SQL {
  switch (parsed.source) {
    case 'igdb':
      return sql`${VISIBLE} AND ${schema.torrents.igdbId} = ${parsed.externalId}`;
    case 'openlibrary':
      return sql`${VISIBLE} AND ${schema.torrents.igdbId} IS NULL
                 AND ${schema.torrents.openlibraryId} = ${parsed.externalId}`;
    case 'tmdb':
      return sql`${VISIBLE}
        AND ${schema.torrents.igdbId} IS NULL
        AND ${schema.torrents.openlibraryId} IS NULL
        AND ${schema.torrents.tmdbId} = ${parsed.externalId}`;
    default:
      return sql`${VISIBLE} AND ${schema.torrents.id} = ${parsed.externalId}`;
  }
}

/**
 * Narrow a group predicate to one scope, and optionally to one bucket inside
 * it. Written against the columns rather than against `scopeSql` so the
 * `(tmdb_id, season)` index still applies.
 */
export function scopeWhere(
  base: SQL,
  scope: GroupScope,
  bucket?: { season?: number | null; episode?: number | null },
): SQL {
  let out: SQL;
  switch (scope) {
    case 'episode':
      out = sql`${base} AND ${schema.torrents.season} IS NOT NULL
                       AND ${schema.torrents.episode} IS NOT NULL`;
      break;
    case 'season':
      out = sql`${base} AND ${schema.torrents.season} IS NOT NULL
                       AND ${schema.torrents.episode} IS NULL`;
      break;
    case 'integral':
      out = sql`${base} AND ${schema.torrents.season} IS NULL`;
      break;
    default:
      out = base;
  }
  if (bucket?.season != null) {
    out = sql`${out} AND ${schema.torrents.season} = ${bucket.season}`;
  }
  if (bucket?.episode != null) {
    out = sql`${out} AND ${schema.torrents.episode} = ${bucket.episode}`;
  }
  return out;
}
