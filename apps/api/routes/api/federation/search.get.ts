/**
 * GET /api/federation/search?q=<query>&limit=<n>  — inbound, S2S.
 *
 * Live federated search: a partner queries OUR catalogue in real time
 * (accepted + active, metadata only — never `torrent_data`). Same exposure
 * rules as /api/federation/catalog (links point back to us; we never hand over
 * `.torrent` bytes), gated on `sharesWithThem.catalog` + signature. This is the
 * "live" half of the two search modes; the "cache" half is the cron-synced
 * `remote_torrents` read by /api/federation/browse.
 *
 * Signature covers the full request path (incl. query); GET has no body so the
 * digest is over the empty string.
 */
import { eq, and, or, ilike, desc, inArray } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  getFederationConfig,
  isFederationLive,
} from '~~/utils/federation/config';
import { verifySignedRequest } from '~~/utils/federation/signing';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { escapeLike } from '~~/utils/sql';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

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
  if (!peer.sharesWithThem?.catalog) {
    throw createError({
      statusCode: 403,
      message: 'Catalogue not shared with this peer',
    });
  }

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
  const search = typeof q.q === 'string' ? q.q.trim() : '';
  if (search.length < 2) {
    throw createError({ statusCode: 400, message: 'query too short' });
  }
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(q.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );

  const esc = `%${escapeLike(search)}%`;
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
    .where(
      and(
        eq(schema.torrents.moderationStatus, 'accepted'),
        eq(schema.torrents.isActive, true),
        or(
          ilike(schema.torrents.name, esc),
          eq(schema.torrents.infoHash, search.toLowerCase()),
        ),
      ),
    )
    .orderBy(desc(schema.torrents.createdAt))
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

  return { ok: true, items, count: items.length };
});
