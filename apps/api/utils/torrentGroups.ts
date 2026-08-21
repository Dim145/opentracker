/**
 * The vocabulary of release grouping.
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
 * ## What lives here, and what does not
 *
 * This file defines what a group IS — the key, the scope, the release
 * identity, how a key is taken apart again — and nothing about how a page of
 * them is fetched. That is `mixedGroups.ts`, which reads the local catalogue
 * and the federated mirror through these same expressions. The split is
 * deliberate: the vocabulary must not drift between the two catalogues, and
 * the only way to guarantee that is for there to be one copy of it.
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

/**
 * What makes two rows the same RELEASE, as opposed to the same work.
 *
 * The content signature when we have one, the info hash otherwise — the same
 * key the mirror folds partner sources on, deliberately, so the two catalogues
 * never disagree about what "one release" means.
 *
 * `nullif(…, '')` is not defensive noise. The content-signature backfill writes
 * an empty string as a sentinel for "this blob could not be parsed, stop
 * retrying". That never collides with a real digest when you compare
 * signatures for equality, which is what the sentinel was designed for — but
 * `coalesce` treats it as a value, so without the `nullif` every unsignable
 * torrent in the catalogue would fold into a single release.
 */
export const LOCAL_RELEASE_KEY: SQL = sql`coalesce(nullif(${schema.torrents.contentSignature}, ''), ${schema.torrents.infoHash})`;

/** The local catalogue's columns. */
export const TORRENT_COLUMNS: GroupColumns = {
  igdbId: schema.torrents.igdbId,
  openlibraryId: schema.torrents.openlibraryId,
  tmdbId: schema.torrents.tmdbId,
  season: schema.torrents.season,
  episode: schema.torrents.episode,
  // The release key, not the torrent id. Two rows of the same untagged release
  // — a cross-seed here, or a copy mirrored from a partner — are one entry,
  // and this is what lets the local and federated halves recognise each other.
  soloKey: LOCAL_RELEASE_KEY,
};

export const groupKeySql: SQL = groupKeyExpr(TORRENT_COLUMNS);
export const scopeSql: SQL = scopeExpr(TORRENT_COLUMNS);

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
      // Either form of solo key: a release key (what the listing mints now) or
      // a bare torrent id (what it minted before, and what is sitting in
      // people's bookmarks). A uuid can never equal a hex digest or an info
      // hash, so the two namespaces cannot collide and the OR resolves to a
      // BitmapOr over two indexes rather than a scan.
      return sql`${VISIBLE} AND (${schema.torrents.id} = ${parsed.externalId}
                   OR ${LOCAL_RELEASE_KEY} = ${parsed.externalId})`;
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
