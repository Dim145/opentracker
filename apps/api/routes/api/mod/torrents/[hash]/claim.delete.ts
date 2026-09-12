/**
 * DELETE /api/mod/torrents/:hash/claim — rendre un élément à la file.
 *
 * Un modérateur rend le sien ; un administrateur peut reprendre celui d'un
 * autre, parce qu'une réclamation oubliée par quelqu'un en congé ne doit pas
 * attendre les trente minutes d'expiration.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { releaseTorrent } from '~~/utils/moderationQueue';

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const hash = getRouterParam(event, 'hash')?.toLowerCase();
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }

  const torrent = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, hash),
    columns: { id: true },
  });
  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  const released = await releaseTorrent(torrent.id, user.id, {
    force: user.isAdmin,
  });
  if (!released) {
    throw createError({
      statusCode: 409,
      message: 'This upload is claimed by another moderator',
    });
  }
  return { ok: true };
});
