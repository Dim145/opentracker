/**
 * GET /api/federation/browse?q=&page=&limit=&peer=  — authenticated.
 *
 * Reads the local mirror (`remote_torrents`) for the federated-catalogue UI,
 * collapsing the same release seen on multiple partners into ONE item.
 *
 * Dedupe key = coalesce(content_signature, info_hash): a release cross-seeded
 * across instances (same content_signature, different info_hash) and the exact
 * same torrent on two peers (same info_hash) both fold into a single row
 * carrying a `sources[]` array (one per peer). Pagination is over DISTINCT
 * groups, so `total`/`pages` count releases, not raw mirror rows.
 *
 * Gating:
 *   - peer.status = 'active'  — a suspended/blocked/revoked peer's cached rows
 *     aren't purged on status change (only on DELETE), so filter at serve time.
 *   - adult                   — viewers without `showAdultContent` never see
 *     adult-categorised rows (mirrors torrents/index.get.ts).
 * Plus two hints against the LOCAL catalogue: existsLocally (same info_hash)
 * and sameContentLocally (same content_signature, different info_hash).
 */
import { ilike, and, or, eq, sql, inArray } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { escapeLike } from '~~/utils/sql';
import { requireAuthSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { showAdultContent: true },
  });
  const showAdult = me?.showAdultContent ?? false;

  const q = getQuery(event);
  const search = typeof q.q === 'string' ? q.q.trim() : '';
  const peerId = typeof q.peer === 'string' && q.peer ? q.peer : null;
  const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(String(q.limit ?? '50'), 10) || 50),
  );
  const offset = (page - 1) * limit;

  // Group the same release across peers. content_signature catches cross-seeds
  // (same files, different .torrent); info_hash is the fallback for rows
  // without a signature.
  const gkey = sql<string>`coalesce(${schema.remoteTorrents.contentSignature}, ${schema.remoteTorrents.infoHash})`;

  const conditions = [eq(schema.federationPeers.status, 'active')];
  if (!showAdult) conditions.push(eq(schema.remoteTorrents.isAdult, false));
  if (search) {
    const esc = `%${escapeLike(search)}%`;
    conditions.push(
      or(
        ilike(schema.remoteTorrents.name, esc),
        eq(schema.remoteTorrents.infoHash, search.toLowerCase()),
      )!,
    );
  }
  if (peerId) conditions.push(eq(schema.remoteTorrents.peerId, peerId));
  const where = and(...conditions);

  // 1. The page's distinct groups, newest-first by the group's freshest row.
  const groups = await db
    .select({ gkey })
    .from(schema.remoteTorrents)
    .innerJoin(
      schema.federationPeers,
      eq(schema.remoteTorrents.peerId, schema.federationPeers.id),
    )
    .where(where)
    .groupBy(gkey)
    .orderBy(sql`max(${schema.remoteTorrents.remoteCreatedAt}) desc nulls last`)
    .limit(limit)
    .offset(offset);
  const pageKeys = groups.map((g) => g.gkey);

  // 2. Total = number of distinct releases (for pagination).
  const [{ total }] = await db
    .select({ total: sql<number>`count(distinct ${gkey})::int` })
    .from(schema.remoteTorrents)
    .innerJoin(
      schema.federationPeers,
      eq(schema.remoteTorrents.peerId, schema.federationPeers.id),
    )
    .where(where);

  const pagination = {
    page,
    limit,
    total: total ?? 0,
    pages: Math.ceil((total ?? 0) / limit) || 1,
  };
  if (!pageKeys.length) return { items: [], pagination };

  // 3. Every source row for the page's groups.
  const rows = await db
    .select({
      gkey,
      id: schema.remoteTorrents.id,
      infoHash: schema.remoteTorrents.infoHash,
      contentSignature: schema.remoteTorrents.contentSignature,
      name: schema.remoteTorrents.name,
      size: schema.remoteTorrents.size,
      categorySlug: schema.remoteTorrents.categorySlug,
      categoryType: schema.remoteTorrents.categoryType,
      isAdult: schema.remoteTorrents.isAdult,
      tags: schema.remoteTorrents.tags,
      imdbId: schema.remoteTorrents.imdbId,
      tmdbId: schema.remoteTorrents.tmdbId,
      seeders: schema.remoteTorrents.seeders,
      leechers: schema.remoteTorrents.leechers,
      uploaderName: schema.remoteTorrents.uploaderName,
      remoteCreatedAt: schema.remoteTorrents.remoteCreatedAt,
      detailUrl: schema.remoteTorrents.remoteDetailUrl,
      peerId: schema.remoteTorrents.peerId,
      peerName: schema.federationPeers.displayName,
      peerBaseUrl: schema.federationPeers.baseUrl,
    })
    .from(schema.remoteTorrents)
    .innerJoin(
      schema.federationPeers,
      eq(schema.remoteTorrents.peerId, schema.federationPeers.id),
    )
    .where(and(where, inArray(gkey, pageKeys)));

  // Local-dup hints: which info_hashes / content_signatures already exist here.
  const hashes = rows.map((r) => r.infoHash);
  const sigs = rows
    .map((r) => r.contentSignature)
    .filter((s): s is string => !!s);
  const localRows =
    hashes.length || sigs.length
      ? await db
          .select({
            infoHash: schema.torrents.infoHash,
            contentSignature: schema.torrents.contentSignature,
          })
          .from(schema.torrents)
          .where(
            or(
              hashes.length
                ? inArray(schema.torrents.infoHash, hashes)
                : sql`false`,
              sigs.length
                ? inArray(schema.torrents.contentSignature, sigs)
                : sql`false`,
            ),
          )
      : [];
  const localHashes = new Set(localRows.map((l) => l.infoHash));
  const localSigs = new Set(
    localRows.map((l) => l.contentSignature).filter((s): s is string => !!s),
  );

  type Row = (typeof rows)[number];
  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = byKey.get(r.gkey);
    if (arr) arr.push(r);
    else byKey.set(r.gkey, [r]);
  }

  const tsOf = (d: string | Date | null) =>
    d ? new Date(d).getTime() || 0 : 0;

  // Preserve the page's group ordering (newest-first) from step 1.
  const items = pageKeys.map((k) => {
    const grp = (byKey.get(k) ?? [])
      .slice()
      .sort((a, b) => tsOf(b.remoteCreatedAt) - tsOf(a.remoteCreatedAt));
    const rep = grp[0]!;
    const sources = grp.map((s) => ({
      id: s.id,
      peerId: s.peerId,
      peerName: s.peerName,
      peerBaseUrl: s.peerBaseUrl,
      uploaderName: s.uploaderName,
      categorySlug: s.categorySlug,
      seeders: s.seeders,
      leechers: s.leechers,
      detailUrl: s.detailUrl,
    }));
    const existsLocally = grp.some((s) => localHashes.has(s.infoHash));
    const sameContentLocally =
      !existsLocally &&
      grp.some((s) => !!s.contentSignature && localSigs.has(s.contentSignature));
    return {
      // Representative (newest source) for the headline fields.
      id: rep.id,
      key: k,
      infoHash: rep.infoHash,
      contentSignature: rep.contentSignature,
      name: rep.name,
      size: rep.size,
      categorySlug: rep.categorySlug,
      categoryType: rep.categoryType,
      isAdult: rep.isAdult,
      tags: rep.tags,
      imdbId: rep.imdbId,
      tmdbId: rep.tmdbId,
      uploaderName: rep.uploaderName,
      remoteCreatedAt: rep.remoteCreatedAt,
      // Swarm totalled across every source instance.
      seeders: grp.reduce((a, s) => a + (s.seeders || 0), 0),
      leechers: grp.reduce((a, s) => a + (s.leechers || 0), 0),
      // Headline origin = representative; full list in `sources`.
      peerId: rep.peerId,
      peerName: rep.peerName,
      peerBaseUrl: rep.peerBaseUrl,
      detailUrl: rep.detailUrl,
      sourceCount: sources.length,
      sources,
      existsLocally,
      sameContentLocally,
    };
  });

  return { items, pagination };
});
