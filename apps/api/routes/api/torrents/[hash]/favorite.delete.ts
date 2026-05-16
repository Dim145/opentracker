/**
 * DELETE /api/torrents/:hash/favorite
 *
 * Drop the favorite pin for the caller. Silent if the row was
 * never there — same idempotency contract as the sibling POST,
 * so the UI doesn't need to track prior state.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { torrents, torrentFavorites } from '@trackarr/db/schema';
import { requireAuthSession } from '~~/utils/adminAuth';
import { validateParam, infoHashSchema } from '~~/utils/schemas';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  const hash = validateParam(event, 'hash', infoHashSchema);

  const torrent = await db.query.torrents.findFirst({
    where: eq(torrents.infoHash, hash.toLowerCase()),
    columns: { id: true },
  });

  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  await db
    .delete(torrentFavorites)
    .where(
      and(
        eq(torrentFavorites.userId, session.user.id),
        eq(torrentFavorites.torrentId, torrent.id),
      ),
    );

  return { favorited: false };
});
