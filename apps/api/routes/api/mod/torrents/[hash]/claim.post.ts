/**
 * POST /api/mod/torrents/:hash/claim — « je prends celui-là ».
 *
 * Ni `torrents` ni `reports` ne portaient d'assignation : deux modérateurs
 * connectés en même temps ouvraient le même envoi, l'un tranchait, l'autre
 * découvrait que sa décision était sans objet. Sur une équipe de deux c'est
 * agaçant, sur une équipe de huit c'est du travail perdu tous les jours.
 *
 * La réclamation EXPIRE (CLAIM_TTL_MS). Un onglet fermé ne doit pas retirer
 * une ligne de la file de tout le monde pour toujours.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { claimTorrent } from '~~/utils/moderationQueue';

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const hash = getRouterParam(event, 'hash')?.toLowerCase();
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }

  const torrent = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, hash),
    columns: { id: true, moderationStatus: true },
  });
  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }
  if (torrent.moderationStatus !== 'pending') {
    // Rien à réclamer sur une ligne déjà tranchée. 409 plutôt que 400 : la
    // requête était bien formée, c'est l'état qui ne s'y prête plus.
    throw createError({
      statusCode: 409,
      message: 'This upload has already been decided',
    });
  }

  const ok = await claimTorrent(torrent.id, user.id);
  if (!ok) {
    throw createError({
      statusCode: 409,
      message: 'Another moderator is already working on this upload',
    });
  }
  return { ok: true };
});
