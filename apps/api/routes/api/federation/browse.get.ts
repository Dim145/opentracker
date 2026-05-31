/**
 * GET /api/federation/browse?q=&page=&limit=&peer=  — authenticated.
 *
 * Reads the local mirror (`remote_torrents`) for the federated-catalogue
 * UI. Joins the peer so each row carries its origin (name + URL), and adds
 * two dedupe hints against the local catalogue:
 *   - existsLocally      — same info_hash is already here (literally the same
 *                          torrent).
 *   - sameContentLocally — same content_signature but a different info_hash
 *                          (a cross-seed of the same files).
 * Revoked peers cascade-delete their rows, so an inner join hides them.
 */
import { desc, ilike, and, or, eq, sql, inArray } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { escapeLike } from '~~/utils/sql';
import { requireAuthSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAuthSession(event);

  const q = getQuery(event);
  const search = typeof q.q === 'string' ? q.q.trim() : '';
  const peerId = typeof q.peer === 'string' && q.peer ? q.peer : null;
  const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1);
  const limit = Math.min(
    100,
    Math.max(1, parseInt(String(q.limit ?? '50'), 10) || 50),
  );
  const offset = (page - 1) * limit;

  const conditions = [];
  if (search) {
    const esc = `%${escapeLike(search)}%`;
    conditions.push(
      or(
        ilike(schema.remoteTorrents.name, esc),
        eq(schema.remoteTorrents.infoHash, search.toLowerCase()),
      ),
    );
  }
  if (peerId) conditions.push(eq(schema.remoteTorrents.peerId, peerId));
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: schema.remoteTorrents.id,
      infoHash: schema.remoteTorrents.infoHash,
      contentSignature: schema.remoteTorrents.contentSignature,
      name: schema.remoteTorrents.name,
      size: schema.remoteTorrents.size,
      categorySlug: schema.remoteTorrents.categorySlug,
      categoryType: schema.remoteTorrents.categoryType,
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
    .where(where)
    .orderBy(desc(schema.remoteTorrents.remoteCreatedAt))
    .limit(limit)
    .offset(offset);

  // Dedupe hints: which of these info_hashes / content_signatures already
  // exist locally? One query covers both via OR.
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

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.remoteTorrents)
    .innerJoin(
      schema.federationPeers,
      eq(schema.remoteTorrents.peerId, schema.federationPeers.id),
    )
    .where(where);

  const items = rows.map((r) => {
    const existsLocally = localHashes.has(r.infoHash);
    const sameContentLocally =
      !existsLocally && !!r.contentSignature && localSigs.has(r.contentSignature);
    return { ...r, existsLocally, sameContentLocally };
  });

  return {
    items,
    pagination: {
      page,
      limit,
      total: total ?? 0,
      pages: Math.ceil((total ?? 0) / limit),
    },
  };
});
