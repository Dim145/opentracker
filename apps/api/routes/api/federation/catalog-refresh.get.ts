/**
 * GET /api/federation/catalog-refresh?since=&sinceId=&limit=  — inbound, S2S.
 *
 * "Changed rows" feed. The catalogue feed (`catalog.get`) is an append-forward
 * cursor over `created_at` and never re-reads an already-synced torrent, so a
 * metadata edit (rename, re-category, tag change) or a re-eligibility flip
 * (re-approved, uploader un-banned) never reaches partner mirrors. This feed
 * walks `torrents.updated_at` instead — which is NULL until first edited, so
 * brand-new rows stay on the catalogue feed and only genuine CHANGES land here.
 * The partner UPSERTs each item onto `remote_torrents` (re-adding a row a prior
 * tombstone removed, or refreshing a stale one).
 *
 * Same metadata shape, scope (`catalog`), eligibility, and µs cursor as the
 * catalogue feed.
 */
import { eq, and, or, asc, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { verifyInboundS2S } from '~~/utils/federation/inbound';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export default defineEventHandler(async (event) => {
  const { config } = await verifyInboundS2S(event, 'catalog');

  const q = getQuery(event);
  const sinceStr =
    typeof q.since === 'string' && !Number.isNaN(new Date(q.since).getTime())
      ? q.since
      : null;
  const sinceId = typeof q.sinceId === 'string' ? q.sinceId : null;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(q.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );

  const conditions = [
    eq(schema.torrents.moderationStatus, 'accepted'),
    eq(schema.torrents.isActive, true),
    or(isNull(schema.users.id), eq(schema.users.isBanned, false))!,
    // Only rows that have actually been edited (updated_at is NULL otherwise).
    sql`${schema.torrents.updatedAt} is not null`,
  ];
  if (sinceStr) {
    conditions.push(
      sinceId
        ? sql`(${schema.torrents.updatedAt} > ${sinceStr}::timestamp or (${schema.torrents.updatedAt} = ${sinceStr}::timestamp and ${schema.torrents.id} > ${sinceId}))`
        : sql`${schema.torrents.updatedAt} > ${sinceStr}::timestamp`,
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
      isAdult: schema.categories.isAdult,
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
      cursor: sql<string>`to_char(${schema.torrents.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
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
    .orderBy(asc(schema.torrents.updatedAt), asc(schema.torrents.id))
    .limit(limit);

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
    isAdult: !!r.isAdult,
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
    detailUrl: base ? `${base}/torrents/${r.infoHash}` : null,
    downloadUrl: base ? `${base}/torrents/${r.infoHash}` : null,
  }));

  const lastRow = rows[rows.length - 1];
  const nextCursor = lastRow
    ? { t: lastRow.cursor, id: lastRow.id }
    : sinceStr
      ? { t: sinceStr, id: sinceId }
      : null;

  return { ok: true, items, nextCursor, count: items.length };
});
