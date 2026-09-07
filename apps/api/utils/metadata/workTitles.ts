import { db, schema } from '@trackarr/db';
import { tmdbLocale } from './tmdb';

/**
 * Déposer le titre d'une œuvre dans `work_titles`.
 *
 * Chaque lookup de métadonnées passe ici : le titre dans la langue demandée,
 * et le titre original sous la pseudo-langue `orig` quand il diffère — c'est
 * lui qu'un membre tape le plus souvent (« sousou no frieren »). La recherche
 * plein texte du catalogue lit ces lignes par l'identifiant externe du torrent.
 */
export async function upsertWorkTitles(
  source: string,
  externalId: string,
  meta: { title: string; originalTitle?: string | null; year?: number | null },
  language?: string,
): Promise<void> {
  const title = meta.title?.trim();
  if (!title) return;
  const locale = source === 'tmdb' ? tmdbLocale(language) : 'en';
  const bareId = source === 'tmdb' ? externalId.replace(/^(movie|tv)\//, '') : externalId;
  const rows = [{ locale, title }];
  const original = meta.originalTitle?.trim();
  if (original && original.toLowerCase() !== title.toLowerCase()) rows.push({ locale: 'orig', title: original });
  for (const row of rows) {
    await db
      .insert(schema.workTitles)
      .values({
        source,
        externalId,
        bareId,
        locale: row.locale,
        title: row.title,
        originalTitle: original ?? null,
        year: meta.year ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.workTitles.source, schema.workTitles.externalId, schema.workTitles.locale],
        set: { title: row.title, originalTitle: original ?? null, year: meta.year ?? null, bareId, updatedAt: new Date() },
      });
  }
}
