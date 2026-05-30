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
import { eq, and, gt, asc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  getFederationConfig,
  isFederationLive,
} from '~~/utils/federation/config';
import { verifySignedRequest } from '~~/utils/federation/signing';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.public);

  const config = await getFederationConfig();
  if (!isFederationLive(config)) {
    throw createError({ statusCode: 404, message: 'Federation not enabled' });
  }

  const headers = getRequestHeaders(event);
  const senderId = headers['x-trackarr-instance'];
  if (!senderId) {
    throw createError({ statusCode: 401, message: 'Missing instance header' });
  }

  const [peer] = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.instanceId, senderId))
    .limit(1);
  if (!peer || !peer.publicKey) {
    throw createError({ statusCode: 404, message: 'Unknown peer' });
  }
  if (peer.status !== 'active') {
    throw createError({ statusCode: 403, message: 'Peer not active' });
  }
  // We must be sharing the catalogue scope with THEM.
  if (!peer.sharesWithThem?.catalog) {
    throw createError({
      statusCode: 403,
      message: 'Catalogue not shared with this peer',
    });
  }

  // A GET carries no body — and h3's readRawBody throws 405 on GET/HEAD,
  // so we must NOT call it here. The signed digest covers the empty string.
  const verdict = verifySignedRequest({
    method: 'GET',
    pathname: event.path, // full path incl. query — matches what was signed
    rawBody: '',
    headers,
    publicKeyPem: peer.publicKey,
  });
  if (!verdict.ok) {
    throw createError({
      statusCode: 401,
      message: `Signature rejected: ${verdict.reason}`,
    });
  }

  const q = getQuery(event);
  const sinceRaw = typeof q.since === 'string' ? new Date(q.since) : null;
  const since = sinceRaw && !Number.isNaN(sinceRaw.getTime()) ? sinceRaw : null;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(q.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );

  const conditions = [
    eq(schema.torrents.moderationStatus, 'accepted'),
    eq(schema.torrents.isActive, true),
  ];
  if (since) conditions.push(gt(schema.torrents.createdAt, since));

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
    .orderBy(asc(schema.torrents.createdAt))
    .limit(limit);

  const base = (config!.publicUrl || '').replace(/\/$/, '');
  const items = rows.map((r) => ({
    remoteId: r.id,
    infoHash: r.infoHash,
    contentSignature: r.contentSignature,
    name: r.name,
    size: r.size,
    description: r.description,
    categorySlug: r.categorySlug,
    categoryType: r.categoryType,
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

  const nextCursor = items.length
    ? items[items.length - 1]!.createdAt
    : (since ?? null);

  return { ok: true, items, nextCursor, count: items.length };
});
