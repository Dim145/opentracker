/**
 * POST /api/torrents/:hash/favorite
 *
 * Pin a torrent to the caller's private favorites. Idempotent —
 * a second POST is a no-op rather than a 409: the UI's star
 * toggle should never need to know about prior state, and a
 * race between two tabs flipping the same row resolves cleanly.
 *
 * No notification to the uploader. Favorites are strictly
 * private, and surfacing "X starred your upload" would tilt the
 * feature into a popularity contest the tracker doesn't need.
 */
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { torrents, torrentFavorites } from '@trackarr/db/schema';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateParam, infoHashSchema } from '~~/utils/schemas';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const hash = validateParam(event, 'hash', infoHashSchema);

  const torrent = await db.query.torrents.findFirst({
    where: eq(torrents.infoHash, hash.toLowerCase()),
    columns: { id: true },
  });

  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  await db
    .insert(torrentFavorites)
    .values({
      userId: session.user.id,
      torrentId: torrent.id,
    })
    .onConflictDoNothing();

  return { favorited: true };
});
