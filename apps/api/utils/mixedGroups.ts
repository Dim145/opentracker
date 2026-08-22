/**
 * One catalogue, two sources.
 *
 * The grouped listing folds releases of the same work into one row. Until now
 * it did that twice over: once on `torrents` for `/torrents`, once on
 * `remote_torrents` for `/federated`, with a badge on the local row saying how
 * many releases the partners held. That answered "does somebody have the
 * season I am missing?" without ever answering "where is this release?" — a
 * member still had to open a second page and read a second list to find out
 * that the partner's copy and theirs were the same file.
 *
 * This is the merge. One row per work, holding the releases from both
 * catalogues, deduplicated so that a release present here and on three
 * partners counts once and reads as one thing with four places to get it.
 *
 * ## What makes two rows the same release
 *
 * Not the record id. That was the plan's assumption and it is wrong: a
 * record's content address covers its issuer, its publication date and its
 * URL, so two instances publishing the same torrent mint two different
 * addresses. The record id deduplicates the same STATEMENT relayed by several
 * peers — which the ingest already handles — not the same RELEASE published
 * independently.
 *
 * The key is the release identity both tables already carry:
 * `coalesce(nullif(content_signature, ''), info_hash)`. Same expression, same
 * meaning, both sides. Nothing had to be invented for this; the two halves
 * were already speaking the same language and nobody had made them talk.
 *
 * ## Two axes, still orthogonal
 *
 * The group key folds several releases of one work. The release key folds
 * several copies of one release. They cross rather than compete: a season
 * mirrored from three partners and also present locally is one group, holding
 * one release per episode, each with up to four sources.
 *
 * So every count here is `count(DISTINCT rkey)`, never `count(*)`. Get that
 * wrong and a group claims four times the content it holds, which looks
 * exactly like a well-stocked catalogue.
 *
 * ## Why it costs nothing when you do not federate
 *
 * With no active partner the mirror half is skipped outright and the query
 * degenerates to the local one it replaces. The merge is not a mode an
 * operator opts into; it is what the listing does, and an instance with no
 * peers simply has nothing to merge.
 *
 * ## What it costs when you do
 *
 * Measured on 200 000 local rows (60% carrying a metadata id, folding into
 * 12 000 works) plus 20 000 mirrored rows, in the test container:
 *
 * | | rows | count | total |
 * |---|---|---|---|
 * | the query this replaces | ~290 ms | ~175 ms | **~465 ms** |
 * | merged | ~390 ms | ~275 ms | **~590 ms** |
 *
 * So roughly a quarter more, for reading a second catalogue and deduplicating
 * across both. Neither figure is good, and they are slow for the same
 * pre-existing reason: `count(DISTINCT …)` forces a sort-based
 * `GroupAggregate` over every tagged row, which at this size spills ~20 MB to
 * disk under the default 4 MB `work_mem`. The lever is `work_mem`, not the
 * query — and past that, the persisted group entity `torrentGroups.ts` has
 * been predicting since it was written.
 *
 * Two things were worth doing and are done: the category is taken with a plain
 * `min` rather than a distinct or ordered aggregate (three sorts saved, and
 * the row only ever shows one label), and the untagged half is windowed before
 * it is folded so it can still stream off its partial index.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { SortDirection, TorrentSortKey } from '@trackarr/shared';
import { db, schema } from '@trackarr/db';
import { NOT_MASKED } from './federation/remoteMask';
import {
  LIVE_AT,
  LOCAL_RELEASE_KEY,
  TORRENT_COLUMNS,
  VISIBLE,
  buildGroupOrderBy,
  groupKeyExpr,
  parseGroupKey,
  pickDefault,
  scopeExpr,
  toScopes,
  type GroupScope,
  type GroupSource,
  type RawScopeCounts,
  type ScopeSummary,
} from './torrentGroups';
import {
  RELEASE_KEY,
  REMOTE_COLUMNS,
  REMOTE_LIVE_AT,
} from './remoteGroups';

const rt = schema.remoteTorrents;
const stats = schema.torrentStats;

const localKey = groupKeyExpr(TORRENT_COLUMNS);
const localScope = scopeExpr(TORRENT_COLUMNS);
const remoteKey = groupKeyExpr(REMOTE_COLUMNS);
const remoteScope = scopeExpr(REMOTE_COLUMNS);

/** True for rows that can be folded with others by an external id. */
const LOCAL_TAGGED = sql`(${schema.torrents.tmdbId} IS NOT NULL
  OR ${schema.torrents.igdbId} IS NOT NULL
  OR ${schema.torrents.openlibraryId} IS NOT NULL)`;
const LOCAL_UNTAGGED = sql`(${schema.torrents.tmdbId} IS NULL
  AND ${schema.torrents.igdbId} IS NULL
  AND ${schema.torrents.openlibraryId} IS NULL)`;
const REMOTE_TAGGED = sql`(${rt.tmdbId} IS NOT NULL
  OR ${rt.igdbId} IS NOT NULL
  OR ${rt.openlibraryId} IS NOT NULL)`;
const REMOTE_UNTAGGED = sql`(${rt.tmdbId} IS NULL
  AND ${rt.igdbId} IS NULL
  AND ${rt.openlibraryId} IS NULL)`;

// Active peer AND not locally masked — folded together so every remote read in
// this file (the grouped listing and a group's detail) hides moderated content
// without each having to remember to.
const ACTIVE_PEER = sql`${schema.federationPeers.status} = 'active' AND ${NOT_MASKED}`;

export interface MixedGroupRow {
  key: string;
  source: GroupSource;
  externalId: string;
  /** Distinct releases across both catalogues. Never a row count. */
  releaseCount: number;
  /** How many of them we hold ourselves. */
  localCount: number;
  /** How many of them a partner holds. Sums past `releaseCount` when shared. */
  partnerCount: number;
  /** Partners contributing at least one release. */
  peerCount: number;
  latest: Date;
  minSize: number;
  maxSize: number;
  leadName: string;
  /** Local category ids. Resolvable — these are ours. */
  categoryIds: string[];
  /** Partner category slugs. A foreign namespace: displayed, never resolved. */
  categorySlugs: string[];
  seedMin: number;
  seedMax: number;
  leechMin: number;
  leechMax: number;
  scopes: ScopeSummary[];
  defaultScope: GroupScope;
}

export interface MixedListOptions {
  limit: number;
  offset: number;
  /** Extra predicates over `torrents`, already composed. */
  localWhere?: SQL;
  /** Extra predicates over `remote_torrents`, already composed. */
  remoteWhere?: SQL;
  /** Leave the mirror out — the member asked for our catalogue only. */
  localOnly?: boolean;
  scope?: GroupScope;
  /**
   * Same vocabulary as the flat listing and the same meanings across a group —
   * `buildGroupOrderBy` owns both, so the merged catalogue cannot answer "most
   * seeded" differently from the local one.
   */
  sortBy?: TorrentSortKey;
  order?: SortDirection;
}

type RawMixedGroup = RawScopeCounts & {
  gkey: string;
  release_count: number;
  local_count: number;
  partner_count: number;
  peer_count: number;
  latest: string;
  min_size: string;
  max_size: string;
  lead_name: string;
  category_ids: string[] | null;
  category_slugs: string[] | null;
  seed_min: number | null;
  seed_max: number | null;
  leech_min: number | null;
  leech_max: number | null;
};

/**
 * Both catalogues projected into one shape: a release, wherever it lives.
 *
 * Everything downstream — the aggregate, the scope counts, the ordering —
 * reads these columns and nothing else, which is what keeps a single set of
 * grouping rules from having to know which table a row came from.
 */
function localProjection(where: SQL, tagged: boolean, windowRows?: number): SQL {
  const half = tagged ? LOCAL_TAGGED : LOCAL_UNTAGGED;
  const window = windowRows
    ? sql` ORDER BY ${LIVE_AT} DESC LIMIT ${windowRows}`
    : sql``;
  return sql`
    SELECT ${localKey} AS gkey,
           ${LOCAL_RELEASE_KEY} AS rkey,
           ${localScope} AS scope,
           ${schema.torrents.season} AS season,
           ${schema.torrents.episode} AS episode,
           ${LIVE_AT} AS live_at,
           ${schema.torrents.size} AS size,
           ${schema.torrents.name} AS name,
           coalesce(${stats.seeders}, 0) AS seeders,
           coalesce(${stats.leechers}, 0) AS leechers,
           coalesce(${stats.completed}, 0) AS completed,
           true AS is_local,
           NULL::text AS peer_id,
           ${schema.torrents.categoryId} AS category_id,
           NULL::text AS category_slug
      FROM ${schema.torrents}
      LEFT JOIN ${stats} ON ${stats.infoHash} = ${schema.torrents.infoHash}
     WHERE ${VISIBLE} AND ${half} AND (${where})${window}`;
}

function remoteProjection(where: SQL, tagged: boolean, windowRows?: number): SQL {
  const half = tagged ? REMOTE_TAGGED : REMOTE_UNTAGGED;
  const window = windowRows
    ? sql` ORDER BY ${REMOTE_LIVE_AT} DESC LIMIT ${windowRows}`
    : sql``;
  return sql`
    SELECT ${remoteKey} AS gkey,
           ${RELEASE_KEY} AS rkey,
           ${remoteScope} AS scope,
           ${rt.season} AS season,
           ${rt.episode} AS episode,
           ${REMOTE_LIVE_AT} AS live_at,
           ${rt.size} AS size,
           ${rt.name} AS name,
           coalesce(${rt.seeders}, 0) AS seeders,
           coalesce(${rt.leechers}, 0) AS leechers,
           coalesce(${rt.completed}, 0) AS completed,
           false AS is_local,
           ${rt.peerId} AS peer_id,
           NULL::text AS category_id,
           ${rt.categorySlug} AS category_slug
      FROM ${rt}
      INNER JOIN ${schema.federationPeers}
              ON ${schema.federationPeers.id} = ${rt.peerId}
     WHERE ${ACTIVE_PEER} AND ${half} AND (${where})${window}`;
}

/**
 * The aggregate, written once and applied to whichever half is passed in.
 *
 * The totals need one row per RELEASE, and the union holds one row per release
 * PER SOURCE — the same file on our tracker and on two partners is three rows.
 * Summing those would tell a member a group weighs three times what it does,
 * and would count one swarm three times. So a window function elects one row
 * per release and the sums read only those.
 *
 * Which row wins is a decision, not a tie-break: ours first, then the
 * best-seeded partner. Our own figures come from our own tracker, and between
 * two partners' hearsay the livelier reading is the one a member can act on.
 * The min–max span the row displays still reads every source — it is answering
 * a different question, namely whether the copy you want is dead.
 */
function aggregate(source: SQL): SQL {
  return sql`
    SELECT gkey,
           count(DISTINCT rkey)::int AS release_count,
           count(DISTINCT rkey) FILTER (WHERE is_local)::int AS local_count,
           count(DISTINCT rkey) FILTER (WHERE NOT is_local)::int AS partner_count,
           count(DISTINCT peer_id)::int AS peer_count,
           max(live_at) AS latest,
           -- The other end of the age span. "Oldest first" has to rank a
           -- group by its oldest release, not by its newest.
           min(live_at) AS oldest,
           sum(size) FILTER (WHERE rn = 1) AS total_size,
           sum(seeders) FILTER (WHERE rn = 1)::int AS seed_total,
           sum(leechers) FILTER (WHERE rn = 1)::int AS leech_total,
           sum(completed) FILTER (WHERE rn = 1)::int AS completed_total,
           min(size) AS min_size,
           max(size) AS max_size,
           (array_agg(name ORDER BY size DESC))[1] AS lead_name,
           -- One category, not the distinct set of them. The row shows a
           -- single label and the client takes the first id it can resolve, so
           -- the set bought nothing — while every DISTINCT and every ordered
           -- aggregate is another sort on a query whose cost is almost
           -- entirely sorting. A plain min picks one, deterministically, free.
           array_remove(ARRAY[min(category_id)], NULL) AS category_ids,
           array_remove(ARRAY[min(category_slug)], NULL) AS category_slugs,
           min(seeders)::int AS seed_min,
           max(seeders)::int AS seed_max,
           min(leechers)::int AS leech_min,
           max(leechers)::int AS leech_max,
           -- Units, not releases: "À l'épisode (7)" means seven episodes
           -- exist, however many encodes and however many partners each has.
           count(DISTINCT (season, episode)) FILTER (WHERE scope = 'episode')::int AS ep_units,
           max(live_at) FILTER (WHERE scope = 'episode') AS ep_latest,
           count(DISTINCT season) FILTER (WHERE scope = 'season')::int AS season_units,
           max(live_at) FILTER (WHERE scope = 'season') AS season_latest,
           count(DISTINCT rkey) FILTER (WHERE scope = 'integral')::int AS integral_units,
           max(live_at) FILTER (WHERE scope = 'integral') AS integral_latest,
           count(DISTINCT rkey) FILTER (WHERE scope = 'all')::int AS all_units,
           max(live_at) FILTER (WHERE scope = 'all') AS all_latest
      FROM (
        SELECT u.*,
               row_number() OVER (
                 PARTITION BY u.gkey, u.rkey
                 ORDER BY u.is_local DESC, u.seeders DESC
               ) AS rn
          FROM (${source}) u
      ) r
     GROUP BY 1`;
}

/**
 * One page of groups, newest first, from both catalogues at once.
 *
 * The tagged and untagged halves stay separate for the same reason the local
 * listing splits them: a `GROUP BY` over the whole of `torrents` is a
 * sequential scan and a hash aggregate on every page, while an untagged row
 * can stream off a partial index and stop at the limit. Merging the mirror in
 * does not change that arithmetic — the mirror is small — so the split is kept
 * and the mirror joins each half.
 *
 * One consequence worth stating, because it is a real limit and not an
 * oversight: the untagged half is windowed before it is folded. Two untagged
 * copies of one release that fall on opposite sides of that window are counted
 * as one group with one source rather than one group with two. It affects only
 * untagged rows — the ones with no metadata id at all — and only when a page
 * boundary falls between two copies of the same file.
 */
export async function listMixedGroups(
  opts: MixedListOptions,
): Promise<{ groups: MixedGroupRow[]; total: number }> {
  const localExtra = opts.localWhere ?? sql`true`;
  const remoteExtra = opts.remoteWhere ?? sql`true`;

  // A scope filter is a predicate over the ROWS, so it composes: a group
  // survives when at least one of its releases is cut that way.
  const localFiltered = opts.scope
    ? sql`(${localExtra}) AND (${localScope}) = ${opts.scope}`
    : localExtra;
  const remoteFiltered = opts.scope
    ? sql`(${remoteExtra}) AND (${remoteScope}) = ${opts.scope}`
    : remoteExtra;

  // An untagged release carries no season, so it is always cut `all` by
  // construction. Any other scope filter excludes the whole half, which is
  // worth saying up front rather than making Postgres discover it row by row.
  const soloWanted = !opts.scope || opts.scope === 'all';
  const soloLocal = soloWanted ? localExtra : sql`false`;
  const soloRemote = soloWanted ? remoteExtra : sql`false`;

  const window = opts.limit + opts.offset;
  const withMirror = !opts.localOnly;

  /** Both halves of the untagged source, windowed or not. */
  const solo = (rows?: number) =>
    withMirror
      ? sql`(${localProjection(soloLocal, false, rows)}) UNION ALL (${remoteProjection(soloRemote, false, rows)})`
      : localProjection(soloLocal, false, rows);

  // Each branch is parenthesised. Without that, a branch's own `ORDER BY … 
  // LIMIT` binds to the whole union instead of to the branch — which Postgres
  // rejects outright rather than silently mis-ordering, mercifully.
  const taggedSource = withMirror
    ? sql`(${localProjection(localFiltered, true)}) UNION ALL (${remoteProjection(remoteFiltered, true)})`
    : localProjection(localFiltered, true);
  const soloSource = solo(window);

  const rows = (await db.execute<RawMixedGroup>(sql`
    SELECT * FROM (
      ${aggregate(taggedSource)}
      UNION ALL
      ${aggregate(soloSource)}
    ) u
     ORDER BY ${buildGroupOrderBy(opts.sortBy ?? 'age', opts.order ?? 'desc')}
     LIMIT ${opts.limit} OFFSET ${opts.offset}
  `)) as unknown as RawMixedGroup[];

  // Counted per half and summed: the halves cannot overlap, since a row is
  // either tagged or it is not.
  //
  // The untagged half is counted UNWINDOWED, unlike the half that is listed.
  // The window exists so a page can stream off an index instead of folding the
  // whole catalogue; a total computed through it would say "25" and collapse
  // the pager to a single page. Two different questions, two different
  // queries — and the one nobody sees is the one that has to be exact.
  const countSource = (s: SQL) => sql`SELECT count(DISTINCT gkey)::int AS n FROM (${s}) c`;
  const [countRow] = (await db.execute<{ total: number }>(sql`
    SELECT ((${countSource(taggedSource)}) + (${countSource(solo())}))::int AS total
  `)) as unknown as Array<{ total: number }>;

  return {
    groups: rows.map((r) => {
      const parsed = parseGroupKey(r.gkey);
      const scopes = toScopes(r);
      return {
        key: r.gkey,
        source: parsed.source,
        externalId: parsed.externalId,
        releaseCount: Number(r.release_count),
        localCount: Number(r.local_count),
        partnerCount: Number(r.partner_count),
        peerCount: Number(r.peer_count),
        latest: new Date(r.latest),
        minSize: Number(r.min_size),
        maxSize: Number(r.max_size),
        leadName: r.lead_name,
        categoryIds: r.category_ids ?? [],
        categorySlugs: r.category_slugs ?? [],
        seedMin: Number(r.seed_min ?? 0),
        seedMax: Number(r.seed_max ?? 0),
        leechMin: Number(r.leech_min ?? 0),
        leechMax: Number(r.leech_max ?? 0),
        scopes,
        defaultScope: pickDefault(scopes),
      };
    }),
    total: Number(countRow?.total ?? 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// One group, in detail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every release of one group, from both catalogues, as a single relation.
 *
 * A CTE is safe here, unlike in the listing: the fence that cost 375 ms there
 * was Postgres materialising a scan of the whole catalogue. This one is scoped
 * to a single work by an indexed predicate, so materialising it once and
 * reading it three times — scopes, buckets, releases — is exactly what we
 * want.
 */
function groupUnion(local: SQL, remote: SQL, localOnly: boolean): SQL {
  const localHalf = sql`
    SELECT ${LOCAL_RELEASE_KEY} AS rkey,
           ${localScope} AS scope,
           ${schema.torrents.season} AS season,
           ${schema.torrents.episode} AS episode,
           ${LIVE_AT} AS live_at,
           ${schema.torrents.size} AS size,
           ${schema.torrents.name} AS name,
           ${schema.torrents.infoHash} AS info_hash,
           coalesce(${stats.seeders}, 0) AS seeders,
           coalesce(${stats.leechers}, 0) AS leechers,
           coalesce(${stats.completed}, 0) AS completed,
           true AS is_local,
           ${schema.torrents.id} AS torrent_id,
           ${schema.torrents.categoryId} AS category_id,
           NULL::text AS category_slug,
           NULL::text AS peer_id,
           NULL::text AS peer_name,
           NULL::text AS detail_url
      FROM ${schema.torrents}
      LEFT JOIN ${stats} ON ${stats.infoHash} = ${schema.torrents.infoHash}
     WHERE ${local}`;

  if (localOnly) return localHalf;

  return sql`(${localHalf})
    UNION ALL
    (SELECT ${RELEASE_KEY} AS rkey,
           ${remoteScope} AS scope,
           ${rt.season} AS season,
           ${rt.episode} AS episode,
           ${REMOTE_LIVE_AT} AS live_at,
           ${rt.size} AS size,
           ${rt.name} AS name,
           ${rt.infoHash} AS info_hash,
           coalesce(${rt.seeders}, 0) AS seeders,
           coalesce(${rt.leechers}, 0) AS leechers,
           coalesce(${rt.completed}, 0) AS completed,
           false AS is_local,
           NULL::text AS torrent_id,
           NULL::text AS category_id,
           ${rt.categorySlug} AS category_slug,
           ${rt.peerId} AS peer_id,
           ${schema.federationPeers.displayName} AS peer_name,
           ${rt.remoteDetailUrl} AS detail_url
      FROM ${rt}
      INNER JOIN ${schema.federationPeers}
              ON ${schema.federationPeers.id} = ${rt.peerId}
     WHERE ${ACTIVE_PEER} AND (${remote}))`;
}

export interface MixedGroupHeader {
  releaseCount: number;
  localCount: number;
  partnerCount: number;
  minSize: number;
  maxSize: number;
  leadName: string;
  categoryIds: string[];
  categorySlugs: string[];
  scopes: ScopeSummary[];
}

export interface MixedBucket {
  season: number | null;
  episode: number | null;
  releaseCount: number;
  episodeCount: number;
  latest: string;
  seeders: number;
  resolutions: string[];
}

/** One place a release can be got from. */
export interface ReleaseSource {
  kind: 'local' | 'partner';
  peerId: string | null;
  peerName: string | null;
  /** Where to go. Null for the local source, which the UI routes itself. */
  url: string | null;
  seeders: number;
  leechers: number;
}

export interface MixedRelease {
  /** The release identity — content signature, or info hash. */
  key: string;
  name: string;
  size: number;
  season: number | null;
  episode: number | null;
  infoHash: string;
  /** Set when we hold it; this is what makes a download button possible. */
  torrentId: string | null;
  categoryId: string | null;
  categorySlug: string | null;
  latest: string;
  /** Best swarm across the sources — the number that decides which to grab. */
  seeders: number;
  leechers: number;
  sources: ReleaseSource[];
}

/**
 * The scope chips, over both catalogues.
 *
 * The listing row already carries them, but the group page is reached by URL
 * and has no listing behind it — and over a single work this is one indexed
 * aggregate.
 */
export async function mixedGroupHeader(
  local: SQL,
  remote: SQL,
  localOnly: boolean,
): Promise<MixedGroupHeader> {
  const [row] = (await db.execute<Record<string, unknown>>(sql`
    WITH u AS (${groupUnion(local, remote, localOnly)})
    SELECT count(DISTINCT rkey)::int AS release_count,
           count(DISTINCT rkey) FILTER (WHERE is_local)::int AS local_count,
           count(DISTINCT rkey) FILTER (WHERE NOT is_local)::int AS partner_count,
           min(size) AS min_size,
           max(size) AS max_size,
           (array_agg(name ORDER BY size DESC))[1] AS lead_name,
           array_remove(ARRAY[min(category_id)], NULL) AS category_ids,
           array_remove(ARRAY[min(category_slug)], NULL) AS category_slugs,
           count(DISTINCT (season, episode)) FILTER (WHERE scope = 'episode')::int AS ep_units,
           max(live_at) FILTER (WHERE scope = 'episode') AS ep_latest,
           count(DISTINCT season) FILTER (WHERE scope = 'season')::int AS season_units,
           max(live_at) FILTER (WHERE scope = 'season') AS season_latest,
           count(DISTINCT rkey) FILTER (WHERE scope = 'integral')::int AS integral_units,
           max(live_at) FILTER (WHERE scope = 'integral') AS integral_latest,
           count(DISTINCT rkey) FILTER (WHERE scope = 'all')::int AS all_units,
           max(live_at) FILTER (WHERE scope = 'all') AS all_latest
      FROM u
  `)) as unknown as Array<Record<string, unknown>>;

  return {
    releaseCount: Number(row?.release_count ?? 0),
    localCount: Number(row?.local_count ?? 0),
    partnerCount: Number(row?.partner_count ?? 0),
    minSize: Number(row?.min_size ?? 0),
    maxSize: Number(row?.max_size ?? 0),
    leadName: (row?.lead_name as string) ?? '',
    categoryIds: (row?.category_ids as string[] | null) ?? [],
    categorySlugs: (row?.category_slugs as string[] | null) ?? [],
    scopes: toScopes(row as unknown as RawScopeCounts),
  };
}

/** The five tiers a release name is expected to declare. */
const RES = sql`substring(name from '(2160p|1440p|1080p|720p|480p)')`;

/**
 * Seasons, or the episodes of one season — the same aggregate at two depths.
 *
 * Counts are `DISTINCT rkey`, so a season header says how many RELEASES it
 * holds rather than how many mirror rows exist for them. A season present on
 * four partners is not four times the season.
 */
export async function mixedBuckets(
  local: SQL,
  remote: SQL,
  localOnly: boolean,
  by: 'season' | 'episode',
  limit?: number,
): Promise<MixedBucket[]> {
  const col = by === 'season' ? sql`season` : sql`episode`;
  const other = by === 'season'
    ? sql`NULL::smallint AS episode`
    : sql`NULL::smallint AS season`;
  const episodeCount = by === 'season'
    ? sql`count(DISTINCT episode)::int`
    : sql`0`;
  const order = by === 'season'
    ? sql`ORDER BY season`
    // Highest first so the cap, when it bites, keeps the episodes that just
    // aired rather than the first three hundred of a decade-long run.
    : sql`ORDER BY episode DESC`;
  const cap = limit ? sql` LIMIT ${limit}` : sql``;

  const rows = (await db.execute<Record<string, unknown>>(sql`
    WITH u AS (${groupUnion(local, remote, localOnly)})
    SELECT ${col} AS ${sql.raw(by)},
           ${other},
           count(DISTINCT rkey)::int AS release_count,
           ${episodeCount} AS episode_count,
           max(live_at) AS latest,
           coalesce(max(seeders), 0)::int AS seeders,
           array_remove(array_agg(DISTINCT ${RES}), NULL) AS resolutions
      FROM u
     GROUP BY 1
     ${order}${cap}
  `)) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    season: r.season == null ? null : Number(r.season),
    episode: r.episode == null ? null : Number(r.episode),
    releaseCount: Number(r.release_count),
    episodeCount: Number(r.episode_count),
    latest: String(r.latest),
    seeders: Number(r.seeders),
    resolutions: (r.resolutions as string[] | null) ?? [],
  }));
}

/**
 * The releases of one bucket, folded across catalogues.
 *
 * The fold happens here rather than in SQL because it is small — a bucket
 * holds a handful of releases — and because the result is a list of SOURCES
 * per release, which in SQL would mean aggregating composite types for no
 * benefit.
 *
 * A local source comes first when there is one: it is the copy a member can
 * download with their own passkey. The rest are places to go, and they carry
 * their own URL because the record said where the release lives — not because
 * of which partner happened to hand it over.
 */
export async function mixedReleases(
  local: SQL,
  remote: SQL,
  localOnly: boolean,
  limit: number,
): Promise<{ releases: MixedRelease[]; truncated: boolean }> {
  const rows = (await db.execute<Record<string, unknown>>(sql`
    WITH u AS (${groupUnion(local, remote, localOnly)})
    SELECT * FROM u
     -- Biggest first, and the local copy ahead of a partner's at equal size:
     -- the fold below takes the first row it sees as the representative.
     ORDER BY size DESC, is_local DESC
     LIMIT ${limit * 8}
  `)) as unknown as Array<Record<string, unknown>>;

  const byKey = new Map<string, MixedRelease>();
  for (const r of rows) {
    const key = String(r.rkey);
    const source: ReleaseSource = {
      kind: r.is_local ? 'local' : 'partner',
      peerId: (r.peer_id as string | null) ?? null,
      peerName: (r.peer_name as string | null) ?? null,
      url: (r.detail_url as string | null) ?? null,
      seeders: Number(r.seeders ?? 0),
      leechers: Number(r.leechers ?? 0),
    };
    const existing = byKey.get(key);
    if (existing) {
      existing.sources.push(source);
      existing.seeders = Math.max(existing.seeders, source.seeders);
      existing.leechers = Math.max(existing.leechers, source.leechers);
      // A release we also hold ourselves is a release we can serve. Whichever
      // row happened to sort first, the local facts win once they show up.
      if (source.kind === 'local') {
        existing.torrentId = (r.torrent_id as string | null) ?? null;
        existing.categoryId = (r.category_id as string | null) ?? null;
        existing.infoHash = String(r.info_hash);
      }
      continue;
    }
    byKey.set(key, {
      key,
      name: String(r.name),
      size: Number(r.size),
      season: r.season == null ? null : Number(r.season),
      episode: r.episode == null ? null : Number(r.episode),
      infoHash: String(r.info_hash),
      torrentId: (r.torrent_id as string | null) ?? null,
      categoryId: (r.category_id as string | null) ?? null,
      categorySlug: (r.category_slug as string | null) ?? null,
      latest: String(r.live_at),
      seeders: source.seeders,
      leechers: source.leechers,
      sources: [source],
    });
  }

  const all = [...byKey.values()];
  for (const rel of all) {
    rel.sources.sort((a, b) =>
      a.kind === b.kind ? b.seeders - a.seeders : a.kind === 'local' ? -1 : 1,
    );
  }
  return { releases: all.slice(0, limit), truncated: all.length > limit };
}
