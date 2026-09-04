/**
 * GET /api/torrents/:hash/my-obligation
 *
 * Ce que le membre connecté doit encore À CE TORRENT, pour que sa page le dise.
 *
 * `hnr_tracking` porte, par couple (membre, torrent), le temps de seed effectué,
 * le temps exigé, l'état de défaut et l'exemption. Rien de tout cela n'atteignait
 * la page de détail : un membre ne pouvait pas savoir, en regardant le torrent
 * qu'il vient de télécharger, s'il lui devait encore des heures — l'information
 * n'existait que dans la liste de ses téléchargements, une page plus loin.
 *
 * Renvoie `null`, et non un 404, quand il n'y a pas de ligne : « ce membre n'a
 * jamais téléchargé ce torrent » est une réponse, pas une erreur, et le front
 * doit pouvoir masquer la carte sans traiter un cas d'échec.
 *
 * Route à part plutôt qu'un champ du détail, pour deux raisons : la charge du
 * détail est mise en cache et partagée entre membres, alors que cette réponse
 * est propre à un membre ; et la page la charge en `lazy`, donc elle ne retarde
 * pas le premier octet.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { validateParam, infoHashSchema } from '~~/utils/schemas';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  const hash = validateParam(event, 'hash', infoHashSchema);

  const torrent = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, hash.toLowerCase()),
    columns: { id: true },
  });
  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  const [row] = await db
    .select({
      seedTime: schema.hnrTracking.seedTime,
      requiredSeedTime: schema.hnrTracking.requiredSeedTime,
      isHnr: schema.hnrTracking.isHnr,
      isExempt: schema.hnrTracking.isExempt,
      completedAt: schema.hnrTracking.completedAt,
      downloaded: schema.hnrTracking.downloaded,
    })
    .from(schema.hnrTracking)
    .where(
      and(
        eq(schema.hnrTracking.userId, session.user.id),
        eq(schema.hnrTracking.torrentId, torrent.id),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    /*
     * `downloaded > 0` et non « la ligne existe » : l'API pose une ligne dès le
     * clic sur le fichier .torrent, pour que la page des téléchargements montre
     * la release avant le premier octet. Une ligne à zéro octet signifie donc
     * « récupéré, jamais commencé » — et afficher une obligation de seed à
     * quelqu'un qui n'a rien téléchargé serait faux.
     */
    downloaded: row.downloaded > 0,
    seedTime: row.seedTime,
    requiredSeedTime: row.requiredSeedTime,
    isHnr: row.isHnr,
    isExempt: row.isExempt,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
});
