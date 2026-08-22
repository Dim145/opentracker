/**
 * Federated cross-seed matching (M2).
 *
 * For a member who holds an account on this tracker AND on a partner, a release
 * they already seed here may be the same content a partner also carries. Seeding
 * it on both — from the bytes already on their disk — helps swarm health and
 * ratio on both sides for free. The federation's job is only to POINT OUT the
 * match; the member fetches the partner's `.torrent` through their own partner
 * account (their passkey), never through us.
 *
 * The match rides §1: a v2 content root is cryptographic proof of identical
 * content, so it is preferred. `content_signature` (paths + sizes) is the
 * fallback for releases that predate v2 — a hint, flagged as such — and it is
 * suppressed whenever a v2 root exists on both sides and disagrees, because that
 * is proof they are NOT the same despite matching names and sizes.
 */
import { and, desc, eq, or, sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { NOT_MASKED } from './remoteMask';

export interface CrossSeedMatch {
  /** Mirror-row id — the on-site `/federated/<id>` page. */
  id: string;
  infoHash: string;
  name: string;
  size: number;
  seeders: number;
  leechers: number;
  peerName: string;
  /** The partner's own detail page — where the member grabs it with THEIR passkey. */
  detailUrl: string | null;
  /** `v2` = proven identical content; `signature` = same names/sizes (a hint). */
  matchType: 'v2' | 'signature';
}

/**
 * The content key match predicate, shared by the list and the aggregate. Built
 * from the source values known in JS, referencing `remote_torrents` by name.
 */
function keyMatchFor(source: {
  contentRootV2: string | null;
  contentSignature: string | null;
}): SQL | null {
  const rt = schema.remoteTorrents;
  if (source.contentRootV2) {
    const parts: SQL[] = [eq(rt.contentRootV2, source.contentRootV2)];
    if (source.contentSignature) {
      parts.push(
        and(
          sql`${rt.contentRootV2} IS NULL`,
          eq(rt.contentSignature, source.contentSignature),
        )!,
      );
    }
    return or(...parts)!;
  }
  if (source.contentSignature) {
    return eq(rt.contentSignature, source.contentSignature);
  }
  return null;
}

/**
 * Find mirrored releases that are the same content as a local torrent. Returns
 * [] when the source can be matched on neither key. Deduplicated by infohash.
 */
export async function federatedCrossSeedMatches(source: {
  contentRootV2: string | null;
  contentSignature: string | null;
}): Promise<CrossSeedMatch[]> {
  const rt = schema.remoteTorrents;
  const keyMatch = keyMatchFor(source);
  if (!keyMatch) return [];

  const rows = await db
    .selectDistinctOn([rt.infoHash], {
      id: rt.id,
      infoHash: rt.infoHash,
      name: rt.name,
      size: rt.size,
      seeders: rt.seeders,
      leechers: rt.leechers,
      contentRootV2: rt.contentRootV2,
      peerName: sql<string>`coalesce(${schema.federationPeers.displayName}, ${schema.federationPeers.baseUrl})`,
      detailUrl: rt.remoteDetailUrl,
    })
    .from(rt)
    .innerJoin(schema.federationPeers, eq(schema.federationPeers.id, rt.peerId))
    .where(and(eq(schema.federationPeers.status, 'active'), NOT_MASKED, keyMatch))
    .orderBy(rt.infoHash, desc(rt.seeders))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    infoHash: r.infoHash,
    name: r.name,
    size: r.size,
    seeders: r.seeders,
    leechers: r.leechers,
    peerName: r.peerName,
    detailUrl: r.detailUrl,
    matchType:
      source.contentRootV2 && r.contentRootV2 === source.contentRootV2
        ? 'v2'
        : 'signature',
  }));
}

export interface ContentAvailability {
  /** Distinct content-equivalent releases across active partners. */
  releases: number;
  seeders: number;
  leechers: number;
}

/**
 * Mesh-wide availability of the SAME content: how many distinct partner releases
 * carry it and their total seeders/leechers. This is a health signal, not a swarm
 * bridge — a partner's swarm only interconnects with ours when the infohash
 * actually matches (see the module header). It tells a member the content is alive
 * across the mesh, and is worth cross-seeding. Deduped by infohash (best-seeded
 * copy per release), aggregated over the WHOLE match set (not just the listed 50).
 */
export async function federatedContentAvailability(source: {
  contentRootV2: string | null;
  contentSignature: string | null;
}): Promise<ContentAvailability> {
  const rt = schema.remoteTorrents;
  const keyMatch = keyMatchFor(source);
  if (!keyMatch) return { releases: 0, seeders: 0, leechers: 0 };

  const deduped = db
    .selectDistinctOn([rt.infoHash], {
      seeders: rt.seeders,
      leechers: rt.leechers,
    })
    .from(rt)
    .innerJoin(schema.federationPeers, eq(schema.federationPeers.id, rt.peerId))
    .where(and(eq(schema.federationPeers.status, 'active'), NOT_MASKED, keyMatch))
    .orderBy(rt.infoHash, desc(rt.seeders))
    .as('deduped');

  const [agg] = await db
    .select({
      releases: sql<number>`count(*)::int`,
      seeders: sql<number>`coalesce(sum(${deduped.seeders}), 0)::int`,
      leechers: sql<number>`coalesce(sum(${deduped.leechers}), 0)::int`,
    })
    .from(deduped);

  return agg ?? { releases: 0, seeders: 0, leechers: 0 };
}
