/**
 * POST /api/mod/torrents/:hash/snooze — mettre de côté sans clore.
 *
 * Un envoi peut attendre une réponse du membre, une vérification chez un
 * fournisseur de métadonnées, ou simplement la fin d'un week-end. Jusqu'ici il
 * n'y avait que deux issues : trancher, ou laisser encombrer la file. Une file
 * pleine d'éléments sur lesquels personne ne peut avancer finit par ne plus
 * être lue du tout.
 *
 * Un endormi sort de la vue par défaut et revient de lui-même à l'échéance.
 * Il reste atteignable entre-temps par `?snoozed=1` : on met de côté, on ne
 * fait pas disparaître.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';

/** Les durées proposées. Une liste fermée : « jusqu'à quand » n'est pas une
 *  question à poser en texte libre, et un sélecteur de date pour trois choix
 *  réels serait un formulaire là où il faut un bouton. */
const DURATIONS = {
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
} as const;

const bodySchema = z.object({
  duration: z.enum(['1d', '3d', '7d']),
});

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const hash = getRouterParam(event, 'hash')?.toLowerCase();
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }
  const body = await validateBody(event, bodySchema);

  const torrent = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, hash),
    columns: { id: true, moderationStatus: true },
  });
  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }
  if (torrent.moderationStatus !== 'pending') {
    throw createError({
      statusCode: 409,
      message: 'Only a pending upload can be snoozed',
    });
  }

  const until = new Date(Date.now() + DURATIONS[body.duration]);
  await db
    .update(schema.torrents)
    .set({
      moderationSnoozedUntil: until,
      // Mettre de côté, c'est rendre l'élément : on ne le garde pas réservé
      // pendant trois jours.
      moderationClaimedById: null,
      moderationClaimedAt: null,
    })
    .where(eq(schema.torrents.id, torrent.id));

  return { ok: true, snoozedUntil: until };
});
