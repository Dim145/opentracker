import { db, schema } from '@trackarr/db';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { validateQuery, torrentQuerySchema } from '~~/utils/schemas';
import {
  filterConditions,
  searchConditions,
  tagGroupsCondition,
  visibilityConditions,
  type ListingFilters,
} from '~~/utils/torrentListing';

/**
 * GET /api/torrents/facets — ce qui existe dans la recherche courante.
 *
 * Le rail du catalogue affiche, à côté de chaque valeur, le nombre de releases
 * qu'elle donnerait : on voit ce qui existe AVANT de filtrer, au lieu de
 * découvrir une liste vide. Les comptes suivent la règle des facettes : pour
 * une dimension, tous les autres filtres s'appliquent, le sien non — sinon la
 * catégorie cochée serait la seule à compter, et on ne pourrait plus changer.
 *
 * Quatre lectures : catégories, étiquettes, années, options. Les étiquettes
 * ne sont pas rangées par famille ici — c'est le vocabulaire de la barre
 * (`searchTokens.ts`) qui sait qu'un `x265` est un codec ; l'API rend des
 * slugs et des comptes, rien de plus.
 */
const MAX_TAGS = 80;

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const query = validateQuery(event, torrentQuerySchema);
  const viewer = { id: user.id, isAdmin: !!user.isAdmin, isModerator: !!user.isModerator };

  const base: SQL[] = await visibilityConditions(viewer);
  const { primary, fuzzy } = await searchConditions(query.search);
  // Le listing se replie sur la recherche approximative quand l'exacte ne rend
  // rien ; les facettes doivent compter la même chose que ce qu'il montre.
  let search = primary;
  if (primary && fuzzy) {
    const all = await filterConditions(query, viewer);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.torrents)
      .where(and(...base, ...all, primary));
    if ((row?.n ?? 0) === 0) search = fuzzy;
  }
  const withBase = (extra: SQL[]) => and(...base, ...(search ? [search] : []), ...extra);
  const without = (drop: Array<keyof ListingFilters>) => {
    const q: ListingFilters = { ...query };
    for (const k of drop) delete q[k];
    return filterConditions(q, viewer);
  };

  /*
   * Les étiquettes : `tagGroups` porte un groupe par famille (« hevc,x265 »
   * pour le codec, « vostfr » pour la langue). Pour compter la famille du
   * groupe i, on applique tous les groupes SAUF le i-ème — l'API ne sait pas
   * quelle famille est laquelle, mais la page le sait : elle a construit la
   * chaîne, elle lit `tagsByGroup[i]` pour la famille i et `tags` pour les
   * autres.
   */
  const groups = (query.tagGroups ?? '').split(';').filter((g) => g.trim());
  const tagCounts = async (drop: number | null) => {
    const c = await without(['tagGroups']);
    const kept = groups.filter((_, i) => i !== drop).join(';');
    const cond = kept ? tagGroupsCondition(kept) : null;
    return db
      .select({
        slug: schema.tags.slug,
        name: schema.tags.name,
        count: sql<number>`count(DISTINCT ${schema.torrents.id})::int`,
      })
      .from(schema.torrents)
      .innerJoin(schema.torrentTags, eq(schema.torrentTags.torrentId, schema.torrents.id))
      .innerJoin(schema.tags, eq(schema.tags.id, schema.torrentTags.tagId))
      .where(withBase(cond ? [...c, cond] : c))
      .groupBy(schema.tags.slug, schema.tags.name)
      .orderBy(desc(sql`count(DISTINCT ${schema.torrents.id})`), schema.tags.slug)
      .limit(MAX_TAGS);
  };
  const tagsByGroupList = await Promise.all(groups.map((_, i) => tagCounts(i)));
  const tagsByGroup: Record<number, Awaited<ReturnType<typeof tagCounts>>> = {};
  tagsByGroupList.forEach((rows, i) => {
    tagsByGroup[i] = rows;
  });

  const count = async (extra: SQL[]) => {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.torrents).where(withBase(extra));
    return row?.n ?? 0;
  };
  /*
   * Ce que le listing AFFICHERAIT pour ces critères : la recherche exacte, et
   * la recherche approximative seulement si l'exacte ne rend rien — la même
   * règle que lui. Une suggestion « sans 480p : 9 » qui ouvre une page à 1
   * résultat est pire que pas de suggestion.
   */
  const countLikeListing = async (extra: SQL[]) => {
    if (!primary) return count(extra);
    const [exact] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.torrents)
      .where(and(...base, primary, ...extra));
    if ((exact?.n ?? 0) > 0 || !fuzzy) return exact?.n ?? 0;
    const [approx] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.torrents)
      .where(and(...base, fuzzy, ...extra));
    return approx?.n ?? 0;
  };
  const strictConditions = await filterConditions(query, viewer);
  const [total, statsRow] = await Promise.all([
    count(strictConditions),
    // Le collecteur écrit `torrent_stats` par passes : c'est la date que la
    // page affiche à côté de « avec des sources » et du tri par essaim.
    // En ISO UTC explicite : une chaîne nue sans fuseau serait relue comme de
    // l'heure locale par le navigateur — deux heures d'écart en France.
    db.select({ at: sql<string | null>`to_char(max(updated_at), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')` }).from(schema.torrentStats).then((r) => r[0]?.at ?? null),
  ]);

  /*
   * Quand rien ne sort : ce que donnerait la même recherche SANS chacun de ses
   * critères, un compte par critère posé, plus le catalogue entier. C'est
   * l'état vide qui propose au lieu de conclure — et il ne coûte que quand il
   * n'y a rien à afficher.
   */
  let dropOne: Array<{ key: string; count: number }> | null = null;
  let catalogue: number | null = null;
  if (total === 0) {
    const keys: Array<keyof ListingFilters> = [
      'categoryId', 'tag', 'imdbid', 'tmdbid', 'tvdbid', 'uploader', 'year', 'season', 'episode',
      'minSeeders', 'freeleech', 'notTaken', 'hideSuperseded', 'groupKey',
    ];
    const present = keys.filter((k) => query[k] !== undefined && query[k] !== '');
    const jobs: Array<Promise<{ key: string; count: number }>> = present.map(async (k) => ({
      key: k,
      count: await countLikeListing(await without([k])),
    }));
    for (let i = 0; i < groups.length; i++) {
      jobs.push(
        (async () => {
          const c = await without(['tagGroups']);
          const kept = groups.filter((_, j) => j !== i).join(';');
          const cond = kept ? tagGroupsCondition(kept) : null;
          return { key: `tagGroups:${i}`, count: await countLikeListing(cond ? [...c, cond] : c) };
        })(),
      );
    }
    if (query.search) {
      jobs.push(
        (async () => {
          const [row] = await db
            .select({ n: sql<number>`count(*)::int` })
            .from(schema.torrents)
            .where(and(...base, ...strictConditions));
          return { key: 'search', count: row?.n ?? 0 };
        })(),
      );
    }
    const [drops, all] = await Promise.all([
      Promise.all(jobs),
      db.select({ n: sql<number>`count(*)::int` }).from(schema.torrents).where(and(...base)).then((r) => r[0]?.n ?? 0),
    ]);
    dropOne = drops.filter((d) => d.count > 0);
    catalogue = all;
  }

  const [categories, tags, years, options] = await Promise.all([
    without(['categoryId']).then((c) =>
      db
        .select({ id: schema.torrents.categoryId, count: sql<number>`count(*)::int` })
        .from(schema.torrents)
        .where(withBase(c))
        .groupBy(schema.torrents.categoryId),
    ),
    tagCounts(null),
    without(['year']).then(async (c) => {
      // Pas de colonne « année » : c'est le nom qui la porte, comme pour le
      // filtre — la même expression, pour que le compte tienne sa promesse.
      const year = sql<string | null>`substring(${schema.torrents.name} from '(?:^|[^0-9])((?:19|20)[0-9]{2})(?:[^0-9]|$)')`;
      const rows = await db
        .select({ year, count: sql<number>`count(*)::int` })
        .from(schema.torrents)
        .where(withBase(c))
        .groupBy(year)
        .orderBy(year);
      return rows
        .filter((r) => r.year !== null)
        .map((r) => ({ year: Number(r.year), count: r.count }));
    }),
    without(['minSeeders', 'freeleech', 'notTaken', 'hideSuperseded']).then(async (c) => {
      // Dans une liste SELECT, drizzle rend une colonne SANS sa table
      // (`"info_hash"`) : à l'intérieur d'une sous-requête corrélée, ce nom
      // désigne alors la colonne de la sous-requête, et Postgres répond « more
      // than one row ». D'où les identifiants qualifiés à la main.
      const [row] = await db
        .select({
          total: sql<number>`count(*)::int`,
          withSeeders: sql<number>`count(*) FILTER (WHERE COALESCE((SELECT s.seeders FROM torrent_stats s WHERE s.info_hash = torrents.info_hash), 0) > 0)::int`,
          freeleech: sql<number>`count(*) FILTER (WHERE torrents.download_multiplier = 0 AND (torrents.multipliers_until IS NULL OR torrents.multipliers_until > now()))::int`,
          notTaken: sql<number>`count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM hnr_tracking h WHERE h.user_id = ${viewer.id} AND h.torrent_id = torrents.id AND h.downloaded > 0))::int`,
          superseded: sql<number>`count(*) FILTER (WHERE torrents.superseded_by_id IS NOT NULL)::int`,
        })
        .from(schema.torrents)
        .where(withBase(c));
      return row ?? { total: 0, withSeeders: 0, freeleech: 0, notTaken: 0, superseded: 0 };
    }),
  ]);

  return {
    total,
    statsAt: statsRow,
    dropOne,
    catalogue,
    categories: categories.filter((c) => c.id !== null) as Array<{ id: string; count: number }>,
    tags,
    tagsByGroup,
    years,
    options: {
      withSeeders: options.withSeeders,
      freeleech: options.freeleech,
      notTaken: options.notTaken,
      superseded: options.superseded,
    },
  };
});
