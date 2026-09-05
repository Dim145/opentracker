import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { validateParam, infoHashSchema } from '~~/utils/schemas';

/**
 * Les sept derniers points de l'essaim d'un torrent — un par jour.
 *
 * La fiche trace ces points en courbe à côté du bouton de téléchargement et y
 * ajoute elle-même la valeur du moment (celle de `torrent_stats`, qu'elle a
 * déjà) comme dernier point. Sept jours parce que c'est la fenêtre qui répond
 * à la question posée — « ça meurt ou ça revit ? » — sans que la courbe
 * devienne un graphique à lire.
 *
 * Les jours SANS point ne sont pas comblés ici : un jour absent veut dire que
 * le collecteur n'a pas tourné (ou que la table vient d'être créée), pas que
 * l'essaim était vide, et le client peut le dire au lieu de dessiner un zéro.
 *
 * Réservée aux membres, comme le reste de la fiche : le nombre de sources est
 * une information de l'instance, pas une page publique.
 */
export default defineEventHandler(async (event) => {
  await requireAuthSession(event);
  const hash = validateParam(event, 'hash', infoHashSchema).toLowerCase();

  const rows = await db
    .select({
      day: schema.torrentStatsHistory.day,
      seeders: schema.torrentStatsHistory.seeders,
      leechers: schema.torrentStatsHistory.leechers,
    })
    .from(schema.torrentStatsHistory)
    .where(
      and(
        eq(schema.torrentStatsHistory.infoHash, hash),
        gte(schema.torrentStatsHistory.day, sql`current_date - 7`),
      ),
    )
    .orderBy(desc(schema.torrentStatsHistory.day))
    .limit(8);

  // Du plus ancien au plus récent : c'est l'ordre d'une courbe.
  return {
    days: 7,
    points: rows.reverse().map((r) => ({
      // `date` arrive en chaîne ISO du jour (`YYYY-MM-DD`) : le pilote ne la
      // convertit pas en `Date`, donc pas de fuseau à démêler.
      day: String(r.day),
      seeders: r.seeders,
      leechers: r.leechers,
    })),
  };
});
