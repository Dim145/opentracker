/**
 * GET /api/federation/catalog?since=<iso>&limit=<n>  — inbound, S2S.
 *
 * Exposes OUR public catalogue (accepted + active torrents, metadata only —
 * never `torrent_data`) to a partner that we share `catalog` with. Paginated
 * by `created_at` ascending; the partner passes back our `nextCursor` to walk
 * forward. Download/detail URLs point back to us: a federated peer never gets
 * our `.torrent` bytes, only a link their user follows with a local account.
 *
 * Signature covers the full request path (incl. query); GET has no body so
 * the digest is over the empty string.
 */
import { eq, and, or, gt, asc, inArray } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { verifyInboundS2S } from '~~/utils/federation/inbound';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export default defineEventHandler(async (event) => {
  const { config } = await verifyInboundS2S(event, 'catalog');

  const q = getQuery(event);
  const sinceRaw = typeof q.since === 'string' ? new Date(q.since) : null;
  const since = sinceRaw && !Number.isNaN(sinceRaw.getTime()) ? sinceRaw : null;
  const sinceId = typeof q.sinceId === 'string' ? q.sinceId : null;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(q.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );

  const conditions = [
    eq(schema.torrents.moderationStatus, 'accepted'),
    eq(schema.torrents.isActive, true),
  ];
  // Composite (created_at, id) cursor. A created_at-only `gt` permanently
  // skips every row that shares the page-boundary timestamp; tie-break on id.
  if (since) {
    conditions.push(
      sinceId
        ? or(
            gt(schema.torrents.createdAt, since),
            and(
              eq(schema.torrents.createdAt, since),
              gt(schema.torrents.id, sinceId),
            ),
          )!
        : gt(schema.torrents.createdAt, since),
    );
  }

  const rows = await db
    .select({
      id: schema.torrents.id,
      infoHash: schema.torrents.infoHash,
      contentSignature: schema.torrents.contentSignature,
      name: schema.torrents.name,
      size: schema.torrents.size,
      description: schema.torrents.description,
      categorySlug: schema.categories.slug,
      categoryType: schema.categories.type,
      imdbId: schema.torrents.imdbId,
      tmdbId: schema.torrents.tmdbId,
      tvdbId: schema.torrents.tvdbId,
      igdbId: schema.torrents.igdbId,
      openlibraryId: schema.torrents.openlibraryId,
      uploaderName: schema.users.username,
      seeders: schema.torrentStats.seeders,
      leechers: schema.torrentStats.leechers,
      completed: schema.torrentStats.completed,
      createdAt: schema.torrents.createdAt,
    })
    .from(schema.torrents)
    .leftJoin(
      schema.categories,
      eq(schema.torrents.categoryId, schema.categories.id),
    )
    .leftJoin(schema.users, eq(schema.torrents.uploaderId, schema.users.id))
    .leftJoin(
      schema.torrentStats,
      eq(schema.torrents.infoHash, schema.torrentStats.infoHash),
    )
    .where(and(...conditions))
    .orderBy(asc(schema.torrents.createdAt), asc(schema.torrents.id))
    .limit(limit);

  // Aggregate tags for the page's torrents in a single round-trip.
  const ids = rows.map((r) => r.id);
  const tagRows = ids.length
    ? await db
        .select({
          torrentId: schema.torrentTags.torrentId,
          name: schema.tags.name,
        })
        .from(schema.torrentTags)
        .innerJoin(schema.tags, eq(schema.torrentTags.tagId, schema.tags.id))
        .where(inArray(schema.torrentTags.torrentId, ids))
    : [];
  const tagsByTorrent = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsByTorrent.get(t.torrentId) ?? [];
    list.push(t.name);
    tagsByTorrent.set(t.torrentId, list);
  }

  const base = (config.publicUrl || '').replace(/\/$/, '');
  const items = rows.map((r) => ({
    remoteId: r.id,
    infoHash: r.infoHash,
    contentSignature: r.contentSignature,
    name: r.name,
    size: r.size,
    description: r.description,
    categorySlug: r.categorySlug,
    categoryType: r.categoryType,
    tags: tagsByTorrent.get(r.id) ?? [],
    imdbId: r.imdbId,
    tmdbId: r.tmdbId,
    tvdbId: r.tvdbId,
    igdbId: r.igdbId,
    openlibraryId: r.openlibraryId,
    seeders: r.seeders ?? 0,
    leechers: r.leechers ?? 0,
    completed: r.completed ?? 0,
    uploaderName: r.uploaderName,
    createdAt: r.createdAt,
    // Links back to the origin instance — followed with a local account
    // there. We never hand over the `.torrent` itself.
    detailUrl: base ? `${base}/torrents/${r.infoHash}` : null,
    downloadUrl: base ? `${base}/torrents/${r.infoHash}` : null,
  }));

  const last = items[items.length - 1];
  const nextCursor = last
    ? { createdAt: last.createdAt, id: last.remoteId }
    : since
      ? { createdAt: since, id: sinceId }
      : null;

  return { ok: true, items, nextCursor, count: items.length };
});
