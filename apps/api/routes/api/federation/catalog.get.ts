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
import { eq, and, or, asc, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { verifyInboundS2S } from '~~/utils/federation/inbound';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export default defineEventHandler(async (event) => {
  const { config } = await verifyInboundS2S(event, 'catalog');

  const q = getQuery(event);
  // Keep the cursor timestamp as its ORIGINAL string — `created_at` is stored
  // at microsecond precision, but `new Date()` truncates to milliseconds. The
  // old code round-tripped through Date, so the boundary row's µs `created_at`
  // was always `> ` its own ms-truncated cursor and got re-fetched on EVERY
  // tick (the (created_at,id) tie-break never engaged). We validate it parses
  // but compare the raw string as a timestamp in SQL below to keep full µs.
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
    // A banned uploader's footprint stops federating out. The torrent stays
    // visible locally (moderation is separate), but we don't propagate a
    // banned member's content/identity to partner instances.
    or(isNull(schema.users.id), eq(schema.users.isBanned, false))!,
  ];
  // Composite (created_at, id) cursor. A created_at-only `gt` permanently
  // skips every row that shares the page-boundary timestamp; tie-break on id.
  if (sinceStr) {
    // Compare the cursor string as a `timestamp` at full precision (no JS Date
    // truncation). `created_at` is `timestamp without time zone`, so cast the
    // ISO string with `::timestamp` (the trailing `Z` is ignored, same wall
    // clock). Equal-timestamp rows now correctly fall through to the id
    // tie-break instead of being perpetually re-fetched.
    conditions.push(
      sinceId
        ? sql`(${schema.torrents.createdAt} > ${sinceStr}::timestamp or (${schema.torrents.createdAt} = ${sinceStr}::timestamp and ${schema.torrents.id} > ${sinceId}))`
        : sql`${schema.torrents.createdAt} > ${sinceStr}::timestamp`,
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
      // Series position. Not decoration: the partner needs it to file a
      // television release under the right season and episode, and the only
      // alternative is re-parsing the name — which every consumer would then
      // have to do, each with its own idea of what a season pack looks like.
      season: schema.torrents.season,
      episode: schema.torrents.episode,
      uploaderName: schema.users.username,
      uploaderAnonymous: schema.users.anonymousUploads,
      seeders: schema.torrentStats.seeders,
      leechers: schema.torrentStats.leechers,
      completed: schema.torrentStats.completed,
      createdAt: schema.torrents.createdAt,
      // Microsecond-precision cursor string for the partner to pass back as
      // `since`. JSON-serialising `createdAt` (a JS Date) would truncate to ms.
      createdAtCursor: sql<string>`to_char(${schema.torrents.createdAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
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
    isAdult: !!r.isAdult,
    tags: tagsByTorrent.get(r.id) ?? [],
    imdbId: r.imdbId,
    tmdbId: r.tmdbId,
    tvdbId: r.tvdbId,
    igdbId: r.igdbId,
    openlibraryId: r.openlibraryId,
    season: r.season,
    episode: r.episode,
    seeders: r.seeders ?? 0,
    leechers: r.leechers ?? 0,
    completed: r.completed ?? 0,
    // An uploader who asked for anonymity gets it across the mesh too:
    // a peer that received the name once has it for good, and we cannot
    // reach into its cache, so the only useful moment is before it
    // leaves. Peers already tolerate a null here (uploader deleted).
    uploaderName: r.uploaderAnonymous ? null : r.uploaderName,
    createdAt: r.createdAt,
    // Links back to the origin instance — followed with a local account
    // there. We never hand over the `.torrent` itself.
    detailUrl: base ? `${base}/torrents/${r.infoHash}` : null,
    downloadUrl: base ? `${base}/torrents/${r.infoHash}` : null,
  }));

  // Cursor carries the µs-precision string (from `rows`, not the ms Date in
  // `items`) so the partner can pass it back without precision loss.
  const lastRow = rows[rows.length - 1];
  const nextCursor = lastRow
    ? { createdAt: lastRow.createdAtCursor, id: lastRow.id }
    : sinceStr
      ? { createdAt: sinceStr, id: sinceId }
      : null;

  return { ok: true, items, nextCursor, count: items.length };
});
