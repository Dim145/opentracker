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
 *
 * ## Both catalogues
 *
 * The releases come from ours and from our partners', folded: a release we
 * hold that a partner also holds is ONE entry with two sources, not two
 * entries. The local source comes first when there is one, because it is the
 * copy a member can download with their own passkey; the others are places to
 * go, each carrying the URL its record declared rather than the address of
 * whichever partner happened to relay it.
 *
 * Every count is over distinct releases. A season mirrored from four partners
 * is a season, not four.
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
  groupMemberWhere,
  parseGroupKey,
  scopeWhere,
  type GroupScope,
} from '~~/utils/torrentGroups';
import {
  mixedBuckets,
  mixedGroupHeader,
  mixedReleases,
} from '~~/utils/mixedGroups';
import {
  hasActiveCataloguePeer,
  remoteGroupMemberWhere,
} from '~~/utils/remoteGroups';
import { getFederationConfig, isFederationLive } from '~~/utils/federation/config';

const querySchema = z.object({
  key: z.string().trim().min(1).max(200),
  scope: z
    .enum(GROUP_SCOPES as unknown as [string, ...string[]])
    .default('all'),
  season: z.coerce.number().int().min(0).max(9_999).optional(),
  episode: z.coerce.number().int().min(0).max(9_999).optional(),
  /** `local` leaves the mirror out; the default merges it in. */
  sources: z.enum(['all', 'local']).default('all'),
});

/**
 * The mirror's equivalent of `scopeWhere`, written against the columns for the
 * same reason: so the `(tmdb_id, season)` index still applies.
 */
function remoteScopeWhere(
  base: SQL,
  scope: GroupScope,
  bucket?: { season?: number | null; episode?: number | null },
): SQL {
  const rt = schema.remoteTorrents;
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

/**
 * Hard caps. Both are generous enough that no real work hits them, and low
 * enough that a pathological one cannot take the page down. When either bites
 * the response says so, because a silently short list reads as a hole in the
 * catalogue.
 */
const MAX_EPISODES = 300;
const MAX_RELEASES = 200;

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const query = await getValidatedQuery(event, querySchema.parse);
  const parsed = parseGroupKey(query.key);
  const scope = query.scope as GroupScope;

  const conditions: SQL[] = [groupMemberWhere(parsed)];
  const remote: SQL[] = [remoteGroupMemberWhere(parsed)];

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
    remote.push(sql`${schema.remoteTorrents.isAdult} = false`);
  }

  const localOnly =
    query.sources === 'local' ||
    !isFederationLive(await getFederationConfig()) ||
    !(await hasActiveCataloguePeer());

  const base = and(...conditions)!;
  const remoteBase = and(...remote)!;

  const header = await mixedGroupHeader(base, remoteBase, localOnly);

  // ── Seasons ────────────────────────────────────────────────────────────
  // Only the two scopes that have them.
  const seasons =
    scope === 'episode' || scope === 'season'
      ? await mixedBuckets(
          scopeWhere(base, scope),
          remoteScopeWhere(remoteBase, scope),
          localOnly,
          'season',
        )
      : [];

  /** Newest wins, at every level. */
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
  let episodes: typeof seasons = [];
  let episodesTruncated = false;

  if (scope === 'episode' && openSeason != null) {
    const rows = await mixedBuckets(
      scopeWhere(base, scope, { season: openSeason }),
      remoteScopeWhere(remoteBase, scope, { season: openSeason }),
      localOnly,
      'episode',
      MAX_EPISODES + 1,
    );
    episodesTruncated = rows.length > MAX_EPISODES;
    episodes = rows
      .slice(0, MAX_EPISODES)
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

  const { releases, truncated: releasesTruncated } = await mixedReleases(
    scopeWhere(base, scope, bucket),
    remoteScopeWhere(remoteBase, scope, bucket),
    localOnly,
    MAX_RELEASES,
  );

  // Live counts, and only here: a handful of releases, and the one place the
  // numbers decide something — which of these do I grab. Only for the copies
  // WE hold: a partner's swarm is theirs to measure, and it arrives on the
  // stats pass rather than from a tracker we do not run.
  const localHashes = releases
    .filter((r) => r.torrentId)
    .map((r) => r.infoHash);
  const live = await Promise.allSettled(localHashes.map((h) => getStats(h)));
  const liveBy = new Map<string, { seeders: number; leechers: number }>();
  localHashes.forEach((h, i) => {
    const s = live[i];
    if (s?.status === 'fulfilled') {
      liveBy.set(h, {
        seeders: s.value.seeders ?? 0,
        leechers: s.value.leechers ?? 0,
      });
    }
  });

  return {
    group: {
      key: query.key,
      source: parsed.source,
      externalId: parsed.externalId,
      releaseCount: header.releaseCount,
      localCount: header.localCount,
      partnerCount: header.partnerCount,
      minSize: header.minSize,
      maxSize: header.maxSize,
      leadName: header.leadName || query.key,
      categoryIds: header.categoryIds,
      categorySlugs: header.categorySlugs,
      scopes: header.scopes,
      // Newest wins, the same rule the listing row uses to pick its chip.
      defaultScope:
        header.scopes.reduce<(typeof header.scopes)[number] | undefined>(
          (best, s) => (!best || s.latest > best.latest ? s : best),
          undefined,
        )?.scope ?? 'all',
    },
    scope,
    merged: !localOnly,
    seasons: seasons.map((s) => ({
      season: s.season,
      releaseCount: s.releaseCount,
      episodeCount: s.episodeCount,
      latest: s.latest,
      seeders: s.seeders,
      resolutions: s.resolutions,
    })),
    openSeason,
    episodes: episodes.map((e) => ({
      episode: e.episode,
      releaseCount: e.releaseCount,
      latest: e.latest,
      seeders: e.seeders,
      resolutions: e.resolutions,
    })),
    episodesTruncated,
    openEpisode,
    releases: releases.map((r) => {
      const swarm = r.torrentId ? liveBy.get(r.infoHash) : undefined;
      const partners = r.sources.filter((s) => s.kind === 'partner');
      return {
        id: r.torrentId,
        infoHash: r.infoHash,
        name: r.name,
        size: r.size,
        season: r.season,
        episode: r.episode,
        categoryId: r.categoryId,
        createdAt: r.latest,
        moderatedAt: null,
        seeders: swarm?.seeders ?? r.seeders,
        leechers: swarm?.leechers ?? r.leechers,
        // One field, two questions. `peers` says who else has this release;
        // `detailUrl` says where to go INSTEAD, and is null when we hold it
        // ourselves — which is exactly the condition under which the row keeps
        // its download button. A release can be both ours and theirs, and that
        // is the case the merge exists to show.
        remote: partners.length
          ? {
              detailUrl: r.torrentId ? null : (partners[0]?.url ?? null),
              peers: partners
                .map((p) => p.peerName)
                .filter((n): n is string => !!n),
            }
          : null,
      };
    }),
    releasesTruncated,
  };
});
