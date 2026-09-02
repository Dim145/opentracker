/**
 * POST /api/me/saved-searches
 *
 * Store a filter. The body is the listing's own vocabulary — the same
 * parameters `/api/torrents` accepts — so the page can hand over whatever the
 * member currently has on screen without translating anything.
 *
 * ## Two refusals worth their code
 *
 * **A filter with no criteria at all** would match every upload forever, which
 * is not a saved search but a firehose. Refused with a message that says what
 * to add rather than a generic 400.
 *
 * **A cap per member.** Every armed filter is evaluated against every accepted
 * upload, so the cost of the feature is the number of armed filters across the
 * site. A ceiling somebody chose beats one that emerges at three in the
 * morning.
 */
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { toExactTsQuery } from '~~/utils/search';
import { slugifyTag } from '~~/utils/tags';
import { normalizeMediaId, tmdbIdBare } from '~~/utils/mediaIds';
import { getSavedSearchMaxPerUser } from '~~/utils/settings';

const bodySchema = z.object({
  label: z.string().trim().min(1).max(80),
  query: z.string().trim().max(255).optional(),
  categoryId: z.string().max(128).optional(),
  /** Tag slugs or names — `slugifyTag` resolves both, as the listing does. */
  tags: z.array(z.string().max(64)).max(10).optional(),
  imdbId: z.string().max(64).optional(),
  tmdbId: z.string().max(64).optional(),
  tvdbId: z.string().max(64).optional(),
  notify: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const body = await validateBody(event, bodySchema);

  const tags = (body.tags ?? []).map(slugifyTag).filter(Boolean);
  const query = body.query?.trim() || null;
  const tsquery = query ? toExactTsQuery(query) : null;
  const imdbId = body.imdbId ? normalizeMediaId('imdb', body.imdbId) : null;
  const tmdbId = body.tmdbId ? tmdbIdBare(body.tmdbId) : null;
  const tvdbId = body.tvdbId?.trim() || null;
  const categoryId = body.categoryId?.trim() || null;

  // `query` without a usable tsquery means the member typed only punctuation —
  // it looks like a criterion and matches nothing, so it does not count as one.
  const hasCriteria =
    !!tsquery || !!categoryId || tags.length > 0 || !!imdbId || !!tmdbId || !!tvdbId;
  if (!hasCriteria) {
    throw createError({
      statusCode: 400,
      // `data.reason` so the browser can pick its own translated sentence.
      // The message here is written for a developer reading a log; echoing it
      // into the page put an English string in front of a French member.
      data: { reason: 'no-criteria' },
      message:
        'A saved search needs at least one criterion — some text, a category, a tag or a media id.',
    });
  }

  /**
   * `tags` part en JSON, pas en tableau JavaScript brut.
   *
   * La colonne est du `jsonb`. Interpolé tel quel dans le gabarit SQL, un
   * tableau JS devient un TABLEAU Postgres, et le serveur refuse :
   * « column "tags" is of type jsonb but expression is of type record ».
   * Toute recherche enregistrée portant au moins une étiquette échouait donc
   * en 500 — alors que la page propose explicitement ce cas (`canSaveSearch`
   * accepte les étiquettes seules) et que `/alerts` affiche déjà une puce par
   * étiquette. Les autres colonnes sont du texte et n'ont jamais eu le
   * problème, ce qui a gardé la panne cantonnée au seul chemin `jsonb`.
   *
   * Écrit ici plutôt qu'en commentaire SQL dans le gabarit ci-dessous : un
   * `--` survit mal à une requête aplatie, et un accent grave dans un modèle
   * littéral le termine.
   */
  const tagsJson = tags.length ? JSON.stringify(tags) : null;

  const max = await getSavedSearchMaxPerUser();
  const id = randomUUID();

  /**
   * The cap is enforced by the INSERT, not by a count before it.
   *
   * Read-then-insert is a race, and this cap is the only bound on what the
   * fan-out costs the whole site: ten concurrent posts at nineteen filters each
   * all read nineteen and all inserted. `INSERT … SELECT … WHERE (SELECT count(*)
   * …) < max` decides it in one statement; an insert that did not happen means
   * the ceiling was reached.
   *
   * Written as SQL rather than through the query builder because the builder's
   * insert-from-select would need every column aliased to its snake_case name
   * by hand anyway, and this way the predicate sits where a reader expects it.
   */
  const inserted = await db.execute(sql`
    insert into ${schema.savedSearches}
      (id, user_id, label, query, tsquery, category_id, tags, imdb_id, tmdb_id, tvdb_id, notify)
    select
      ${id}, ${user.id}, ${body.label}, ${query}, ${tsquery}, ${categoryId},
      ${tagsJson}::jsonb, ${imdbId}, ${tmdbId}, ${tvdbId}, ${body.notify ?? true}
    where (
      select count(*) from ${schema.savedSearches}
      where ${schema.savedSearches.userId} = ${user.id}
    ) < ${max}
    returning id
  `);

  const created =
    (inserted as unknown as { length?: number; count?: number })?.length ??
    (inserted as unknown as { count?: number })?.count ??
    0;
  if (created === 0) {
    throw createError({
      statusCode: 400,
      data: { reason: 'limit', max },
      message: `You can keep up to ${max} saved searches. Delete one first.`,
    });
  }

  return { id, success: true };
});
