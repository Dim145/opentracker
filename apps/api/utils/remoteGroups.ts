/**
 * The federated mirror, folded by work.
 *
 * Same idea as `torrentGroups.ts` — one entry per film, per series, per game,
 * per book — over `remote_torrents` instead of `torrents`. The two share the
 * vocabulary (what a group key is, what a scope is) and nothing else, because
 * the tables genuinely differ:
 *
 * | | local | mirror |
 * |---|---|---|
 * | visibility | moderation status + `is_active` | peer status + mirrored adult flag |
 * | swarm | `torrent_stats`, joined | inline, mirrored from the partner |
 * | recency | `coalesce(moderated_at, created_at)` | `remote_created_at` |
 * | duplicates | none — a row is a torrent | **the same release lives on every partner that has it** |
 *
 * That last row is the whole difficulty.
 *
 * ## Two axes of folding, and they are not the same axis
 *
 * `content_signature` folds **the same release seen on several partners** into
 * one thing with several sources. The group key folds **several releases of the
 * same work** into one entry. They are orthogonal and both are needed: a
 * season of a show mirrored from three partners must read as one season with N
 * releases, not as 3N.
 *
 * So every count here is `count(DISTINCT release_key)`, never `count(*)`. Get
 * that wrong and a group claims three times the content it holds — the kind of
 * error that looks like a well-stocked catalogue.
 */
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  groupKeyExpr,
  parseGroupKey,
  pickDefault,
  scopeExpr,
  toScopes,
  type GroupColumns,
  type GroupScope,
  type ParsedGroupKey,
  type ScopeSummary,
  type RawScopeCounts,
} from './torrentGroups';

const rt = schema.remoteTorrents;

/**
 * What makes two mirror rows the same release: the content signature when the
 * partner computed one, the info hash otherwise. Identical to the key
 * `/api/federation/browse` already folds sources on — deliberately, so the two
 * views never disagree about what "one release" means.
 */
export const RELEASE_KEY: SQL = sql`coalesce(${rt.contentSignature}, ${rt.infoHash})`;

/**
 * When a mirrored release went live, as best we can tell.
 *
 * `remote_created_at` is what the partner told us; it is nullable, because a
 * partner may omit it and older feeds did. Falling back to `fetched_at` — when
 * WE first saw the row — keeps such a release sortable and keeps its scope
 * visible: `toScopes` drops a scope whose latest date is null, so a missing
 * timestamp used to silently erase the chip that says what the group holds.
 */
export const REMOTE_LIVE_AT: SQL = sql`coalesce(${rt.remoteCreatedAt}, ${rt.fetchedAt})`;

export const REMOTE_COLUMNS: GroupColumns = {
  igdbId: rt.igdbId,
  openlibraryId: rt.openlibraryId,
  tmdbId: rt.tmdbId,
  season: rt.season,
  episode: rt.episode,
  // A release key, not a row id: an untagged release mirrored from three
  // partners is one group of one, not three groups of one.
  soloKey: RELEASE_KEY,
};

export const remoteGroupKeySql: SQL = groupKeyExpr(REMOTE_COLUMNS);
export const remoteScopeSql: SQL = scopeExpr(REMOTE_COLUMNS);

/**
 * A suspended or blocked peer's rows are not purged when its status changes —
 * only a hard delete removes them — so the gate has to be applied at read
 * time, exactly as `browse.get.ts` does.
 */
const ACTIVE_PEER = eq(schema.federationPeers.status, 'active');

export interface RemoteGroupRow {
  key: string;
  source: ParsedGroupKey['source'];
  externalId: string;
  /** Distinct releases, not mirror rows. */
  releaseCount: number;
  /** How many partners contribute at least one release to this group. */
  peerCount: number;
  latest: Date;
  minSize: number;
  maxSize: number;
  leadName: string;
  /** Partner category slugs — a foreign namespace, displayed, never resolved. */
  categorySlugs: string[];
  seedMin: number;
  seedMax: number;
  scopes: ScopeSummary[];
  defaultScope: GroupScope;
}

interface RawRemoteGroup extends RawScopeCounts {
  gkey: string;
  release_count: number;
  peer_count: number;
  latest: string;
  min_size: string;
  max_size: string;
  lead_name: string;
  category_slugs: string[] | null;
  seed_min: number | null;
  seed_max: number | null;
}

interface ListOptions {
  limit: number;
  offset: number;
  /** Hide adult-categorised rows — the flag the origin mirrored to us. */
  showAdult: boolean;
  /** Free-text over the release name. */
  search?: string;
  /** Restrict to one partner. */
  peerId?: string | null;
  scope?: GroupScope;
}

function conditions(opts: ListOptions): SQL {
  const parts: SQL[] = [sql`${ACTIVE_PEER}`];
  if (!opts.showAdult) parts.push(sql`${rt.isAdult} = false`);
  if (opts.peerId) parts.push(sql`${rt.peerId} = ${opts.peerId}`);
  if (opts.search) {
    // `ilike` over a mirrored name. The mirror carries no tsvector — building
    // one would mean an index over data we did not author and may drop
    // wholesale when a peer is removed. A partner catalogue is orders of
    // magnitude smaller than the local one, so a trigram-less scan is fine.
    const like = `%${opts.search.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    parts.push(sql`(${rt.name} ILIKE ${like} OR ${rt.infoHash} = ${opts.search.toLowerCase()})`);
  }
  if (opts.scope) parts.push(sql`(${remoteScopeSql}) = ${opts.scope}`);
  return sql.join(parts, sql` AND `);
}

/**
 * One page of federated groups, newest first.
 *
 * No split into a "tagged" and an "untagged" half here, unlike the local
 * listing. That split exists because the local catalogue is six figures of
 * mostly-untagged rows and the untagged half can stream off an index; a
 * partner mirror is thousands of rows, and a plain aggregate over it is
 * cheaper than the machinery to avoid one.
 */
export async function listRemoteGroups(
  opts: ListOptions,
): Promise<{ groups: RemoteGroupRow[]; total: number }> {
  const where = conditions(opts);

  const rows = (await db.execute<RawRemoteGroup>(sql`
    SELECT ${remoteGroupKeySql} AS gkey,
           count(DISTINCT ${RELEASE_KEY})::int AS release_count,
           count(DISTINCT ${rt.peerId})::int AS peer_count,
           max(${REMOTE_LIVE_AT}) AS latest,
           min(${rt.size}) AS min_size,
           max(${rt.size}) AS max_size,
           (array_agg(${rt.name} ORDER BY ${rt.size} DESC))[1] AS lead_name,
           array_remove(array_agg(DISTINCT ${rt.categorySlug}), NULL) AS category_slugs,
           min(${rt.seeders})::int AS seed_min,
           max(${rt.seeders})::int AS seed_max,
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
      FROM ${rt}
      INNER JOIN ${schema.federationPeers}
              ON ${schema.federationPeers.id} = ${rt.peerId}
     WHERE ${where}
     GROUP BY 1
     ORDER BY latest DESC NULLS LAST
     LIMIT ${opts.limit} OFFSET ${opts.offset}
  `)) as unknown as RawRemoteGroup[];

  const [countRow] = (await db.execute<{ total: number }>(sql`
    SELECT count(DISTINCT ${remoteGroupKeySql})::int AS total
      FROM ${rt}
      INNER JOIN ${schema.federationPeers}
              ON ${schema.federationPeers.id} = ${rt.peerId}
     WHERE ${where}
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
        peerCount: Number(r.peer_count),
        latest: new Date(r.latest),
        minSize: Number(r.min_size),
        maxSize: Number(r.max_size),
        leadName: r.lead_name,
        categorySlugs: r.category_slugs ?? [],
        seedMin: Number(r.seed_min ?? 0),
        seedMax: Number(r.seed_max ?? 0),
        scopes,
        defaultScope: pickDefault(scopes),
      };
    }),
    total: Number(countRow?.total ?? 0),
  };
}

/**
 * The predicate selecting one federated group's rows.
 *
 * Built from the parsed parts rather than compared against the key expression,
 * so the plain column indexes apply. A `solo` key here holds a RELEASE key, not
 * a row id — see `REMOTE_COLUMNS.soloKey`.
 */
export function remoteGroupMemberWhere(parsed: ParsedGroupKey): SQL {
  switch (parsed.source) {
    case 'igdb':
      return sql`${rt.igdbId} = ${parsed.externalId}`;
    case 'openlibrary':
      return sql`${rt.igdbId} IS NULL
                 AND ${rt.openlibraryId} = ${parsed.externalId}`;
    case 'tmdb':
      return sql`${rt.igdbId} IS NULL
                 AND ${rt.openlibraryId} IS NULL
                 AND ${rt.tmdbId} = ${parsed.externalId}`;
    default:
      return sql`${rt.igdbId} IS NULL
                 AND ${rt.openlibraryId} IS NULL
                 AND ${rt.tmdbId} IS NULL
                 AND ${RELEASE_KEY} = ${parsed.externalId}`;
  }
}

/** Everything a group page needs to show one federated group. */
export function remoteGroupWhere(
  parsed: ParsedGroupKey,
  showAdult: boolean,
): SQL {
  const parts: SQL[] = [sql`${ACTIVE_PEER}`, remoteGroupMemberWhere(parsed)];
  if (!showAdult) parts.push(sql`${rt.isAdult} = false`);
  return sql.join(parts, sql` AND `);
}

/**
 * How many distinct releases the partners hold for each of these group keys.
 *
 * This is the bridge between the two catalogues, and it is deliberately a
 * BADGE rather than a merge. Folding remote rows into the local group query
 * would mean reconciling two notions of visibility, two adult gates and a
 * heuristic deduplication, inside an aggregate that already unions two halves
 * — for an answer the member can get by clicking through. A count answers the
 * question they actually have ("does a partner have the season I am missing?")
 * for one indexed query per page.
 *
 * Keys with no external id are skipped: an untagged local torrent cannot be
 * matched to a partner by id, and matching it by content signature is the
 * "also available here" hint that `/federated` already renders.
 */
export async function partnerReleaseCounts(
  keys: string[],
  showAdult: boolean,
): Promise<Map<string, number>> {
  const tmdb: string[] = [];
  const igdb: string[] = [];
  const openlibrary: string[] = [];

  for (const key of keys) {
    const p = parseGroupKey(key);
    if (p.source === 'tmdb') tmdb.push(p.externalId);
    else if (p.source === 'igdb') igdb.push(p.externalId);
    else if (p.source === 'openlibrary') openlibrary.push(p.externalId);
  }
  if (!tmdb.length && !igdb.length && !openlibrary.length) return new Map();

  // One OR per id namespace, each against its own index. Building the key
  // expression and comparing THAT to the list would be shorter to write and
  // would scan the whole mirror.
  //
  // `inArray`, not a hand-written `= ANY($1)`: drizzle binds a JS array as ONE
  // scalar parameter, so the raw form silently matches nothing. It fails as an
  // empty badge rather than an error, which is the worst way for it to fail.
  const matches: SQL[] = [];
  if (tmdb.length) matches.push(sql`${inArray(rt.tmdbId, tmdb)}`);
  if (igdb.length) matches.push(sql`${inArray(rt.igdbId, igdb)}`);
  if (openlibrary.length) {
    matches.push(sql`${inArray(rt.openlibraryId, openlibrary)}`);
  }

  const parts: SQL[] = [sql`${ACTIVE_PEER}`, sql`(${sql.join(matches, sql` OR `)})`];
  if (!showAdult) parts.push(sql`${rt.isAdult} = false`);

  const rows = (await db.execute<{ gkey: string; n: number }>(sql`
    SELECT ${remoteGroupKeySql} AS gkey,
           count(DISTINCT ${RELEASE_KEY})::int AS n
      FROM ${rt}
      INNER JOIN ${schema.federationPeers}
              ON ${schema.federationPeers.id} = ${rt.peerId}
     WHERE ${sql.join(parts, sql` AND `)}
     GROUP BY 1
  `)) as unknown as Array<{ gkey: string; n: number }>;

  return new Map(rows.map((r) => [r.gkey, Number(r.n)]));
}

/** True when at least one partner is actively sharing a catalogue with us. */
export async function hasActiveCataloguePeer(): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.federationPeers.id })
    .from(schema.federationPeers)
    .where(and(ACTIVE_PEER))
    .limit(1);
  return !!row;
}
