/**
 * Federated releases, shaped for the machine feeds (Torznab / RSS).
 *
 * The mirror is metadata plus an infohash — no `.torrent` and no local swarm.
 * What a feed CAN offer is a magnet built from the infohash, which the consumer
 * resolves from the swarm wherever that swarm is reachable. This helper reads the
 * mirror with the same gates the human browse uses (active peer, not locally
 * masked, adult opt-in) and, when asked, the same taxonomy bridge the grouped
 * catalogue filter uses, so a `cat=` on the feed lines up with what a member sees.
 *
 * Callers gate this behind an explicit opt-in — see `getTorznabIncludeFederated`.
 */
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { NOT_MASKED } from './remoteMask';
import { remoteCategoryFilter } from './categoryMap';
import { escapeLike } from '~~/utils/sql';

export interface FederatedFeedRow {
  /** The ephemeral mirror-row id — addresses the `/federated/<id>` detail page. */
  id: string;
  infoHash: string;
  name: string;
  size: number;
  seeders: number;
  leechers: number;
  categorySlug: string | null;
  categoryType: string | null;
  description: string | null;
  remoteCreatedAt: Date | null;
}

/**
 * Read mirrored releases for a feed. Deduplicated by infohash (a release several
 * partners carry is one item, keeping the best-seeded copy) and returned newest
 * first, capped at `limit`.
 */
export async function federatedFeedRows(opts: {
  search?: string | null;
  /** Local category ids to restrict to; a mapping bridges foreign slugs in. */
  localCategoryIds?: string[] | null;
  showAdult: boolean;
  limit: number;
}): Promise<FederatedFeedRow[]> {
  const rt = schema.remoteTorrents;
  const conds: SQL[] = [eq(schema.federationPeers.status, 'active'), NOT_MASKED];

  if (!opts.showAdult) conds.push(sql`${rt.isAdult} = false`);

  if (opts.search) {
    const terms = opts.search.split(/\s+/).filter((t) => t.length > 0);
    for (const term of terms) {
      conds.push(ilike(rt.name, `%${escapeLike(term)}%`));
    }
  }

  if (opts.localCategoryIds?.length) {
    // Same two bridges as the grouped catalogue: the conventional shared slug,
    // or an operator-declared mapping. Either matches; neither narrows the other.
    const cats = await db
      .select({ slug: schema.categories.slug })
      .from(schema.categories)
      .where(inArray(schema.categories.id, opts.localCategoryIds));
    const slugs = cats.map((c) => c.slug).filter((s): s is string => !!s);
    conds.push(
      or(
        slugs.length ? inArray(rt.categorySlug, slugs) : sql`false`,
        remoteCategoryFilter(opts.localCategoryIds),
      )!,
    );
  }

  const rows = await db
    .selectDistinctOn([rt.infoHash], {
      id: rt.id,
      infoHash: rt.infoHash,
      name: rt.name,
      size: rt.size,
      seeders: rt.seeders,
      leechers: rt.leechers,
      categorySlug: rt.categorySlug,
      categoryType: rt.categoryType,
      description: rt.description,
      remoteCreatedAt: rt.remoteCreatedAt,
    })
    .from(rt)
    .innerJoin(schema.federationPeers, eq(schema.federationPeers.id, rt.peerId))
    .where(and(...conds))
    // DISTINCT ON needs infohash to lead; the best-seeded copy wins the row.
    .orderBy(rt.infoHash, desc(rt.seeders))
    // Bounded before the JS re-sort so a large mirror can't blow the feed up.
    .limit(500);

  rows.sort(
    (a, b) =>
      (b.remoteCreatedAt?.getTime() ?? 0) - (a.remoteCreatedAt?.getTime() ?? 0),
  );
  return rows.slice(0, opts.limit);
}

/** A magnet the consumer can resolve from the swarm — the only fetch primitive
 *  a metadata mirror can honestly offer. */
export function magnetLink(infoHash: string, name: string): string {
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;
}

/** Coarse Newznab main-category from the normalized type, for feed routing when
 *  no finer local mapping is at hand. */
export function newznabIdForType(type: string | null): number | undefined {
  switch (type) {
    case 'movie':
      return 2000;
    case 'tv':
      return 5000;
    case 'game':
      return 4000;
    case 'book':
      return 7000;
    default:
      return undefined;
  }
}
