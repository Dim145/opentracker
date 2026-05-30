/**
 * GET /api/federation/torrent-comments?infoHash=  — inbound, S2S.
 *
 * Exposes the comments of one of OUR accepted+active torrents to a partner
 * we share `social` with. Read-only, metadata only (author display name +
 * content + timestamp — never local ids). Signed like the catalogue.
 */
import { eq, and, desc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  getFederationConfig,
  isFederationLive,
} from '~~/utils/federation/config';
import { verifySignedRequest } from '~~/utils/federation/signing';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

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
  if (!peer.sharesWithThem?.social) {
    throw createError({ statusCode: 403, message: 'Social not shared with this peer' });
  }

  // GET → no body; readRawBody would 405. Digest covers the empty string.
  const verdict = verifySignedRequest({
    method: 'GET',
    pathname: event.path,
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
  const infoHash =
    typeof q.infoHash === 'string' ? q.infoHash.toLowerCase().trim() : '';
  if (!infoHash) {
    throw createError({ statusCode: 400, message: 'infoHash required' });
  }

  const [torrent] = await db
    .select({ id: schema.torrents.id })
    .from(schema.torrents)
    .where(
      and(
        eq(schema.torrents.infoHash, infoHash),
        eq(schema.torrents.moderationStatus, 'accepted'),
        eq(schema.torrents.isActive, true),
      ),
    )
    .limit(1);
  if (!torrent) return { ok: true, comments: [] };

  const rows = await db
    .select({
      content: schema.torrentComments.content,
      authorName: schema.users.username,
      createdAt: schema.torrentComments.createdAt,
    })
    .from(schema.torrentComments)
    .leftJoin(schema.users, eq(schema.torrentComments.authorId, schema.users.id))
    .where(eq(schema.torrentComments.torrentId, torrent.id))
    .orderBy(desc(schema.torrentComments.createdAt))
    .limit(100);

  return { ok: true, comments: rows };
});
