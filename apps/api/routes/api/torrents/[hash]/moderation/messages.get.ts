/**
 * GET /api/torrents/:hash/moderation/messages
 *
 * Discussion thread between the uploader and the moderation team.
 * Visibility: the uploader of the torrent, or any staff member.
 * Anyone else gets a 404 — we never confirm to a curious viewer that
 * a moderation thread even exists.
 */
import { db, schema } from '@trackarr/db';
import { asc, eq } from 'drizzle-orm';
import { canAccessModerationThread } from '~~/utils/torrentModeration';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const hash = getRouterParam(event, 'hash');
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }

  const torrent = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, hash.toLowerCase()),
    columns: { id: true, uploaderId: true, moderationStatus: true },
  });
  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  if (!canAccessModerationThread({ torrent, user })) {
    // Same opaque 404 as a non-existent torrent so observers can't
    // probe whether a given hash has a moderation history.
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  const messages = await db.query.torrentModerationMessages.findMany({
    where: eq(schema.torrentModerationMessages.torrentId, torrent.id),
    with: {
      author: {
        columns: {
          id: true,
          username: true,
          isAdmin: true,
          isModerator: true,
        },
      },
    },
    orderBy: [asc(schema.torrentModerationMessages.createdAt)],
  });

  return { status: torrent.moderationStatus, messages };
});
