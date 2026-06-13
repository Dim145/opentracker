/**
 * GET /api/federation/torrent-comments?infoHash=  — inbound, S2S.
 *
 * Exposes the comments of one of OUR accepted+active torrents to a partner
 * we share `social` with. Read-only, metadata only (author display name +
 * content + timestamp — never local ids). Signed like the catalogue.
 */
import { eq, and, or, desc, isNull } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { verifyInboundS2S } from '~~/utils/federation/inbound';

export default defineEventHandler(async (event) => {
  await verifyInboundS2S(event, 'social');

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
    // Don't federate a banned user's comments.
    .where(
      and(
        eq(schema.torrentComments.torrentId, torrent.id),
        or(isNull(schema.users.id), eq(schema.users.isBanned, false)),
      ),
    )
    .orderBy(desc(schema.torrentComments.createdAt))
    .limit(100);

  return { ok: true, comments: rows };
});
