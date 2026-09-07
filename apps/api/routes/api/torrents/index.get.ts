import { db, schema } from '@trackarr/db';
import { buildTorrentOrderBy } from '~~/utils/torrentSort';
import { eq, sql, and, type SQL } from 'drizzle-orm';
import { validateQuery, torrentQuerySchema } from '~~/utils/schemas';
import {
  enrichListing,
  filterConditions,
  searchConditions,
  visibilityConditions,
} from '~~/utils/torrentListing';
import { recordSearchMiss } from '~~/utils/searchMisses';

/**
 * GET /api/torrents — le listing plat.
 *
 * Les prédicats vivent dans `utils/torrentListing.ts`, partagés avec la vue
 * groupée et les comptes par facette : une route qui réécrit ses conditions
 * finit par en oublier une, et rien ne le signale. Ce fichier ne garde que ce
 * qui lui est propre — les épinglés en tête de première page, le repli
 * approximatif quand la recherche exacte ne rend rien, la pagination.
 *
 * Chaque ligne porte, en plus de la table, ce que la page du catalogue montre :
 * l'essaim vivant, favori et « déjà prise » pour ce membre, l'uploadeur, la
 * gratuité du moment, et l'œuvre telle que le cache des métadonnées la connaît
 * — sans jamais interroger un fournisseur depuis ici.
 */
const MAX_PINNED = 5;

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const query = validateQuery(event, torrentQuerySchema);
  const offset = (query.page - 1) * query.limit;
  const viewer = {
    id: user.id,
    isAdmin: !!user.isAdmin,
    isModerator: !!user.isModerator,
    language: typeof user.language === 'string' ? user.language : null,
  };

  const conditions: SQL[] = [
    ...(await visibilityConditions(viewer)),
    ...(await filterConditions(query, viewer)),
  ];
  const { primary: searchCondition, fuzzy: fuzzyFallback, rankExact, rankFuzzy } = await searchConditions(query.search);

  const notPinned = eq(schema.torrents.isSticky, false);
  const compose = (search: SQL | null) => {
    const all = search ? [...conditions, search, notPinned] : [...conditions, notPinned];
    return all.length > 0 ? and(...all) : undefined;
  };
  const countRows = async (where: SQL | undefined) => {
    const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.torrents).where(where);
    return row?.count ?? 0;
  };

  let whereClause = compose(searchCondition);
  let total = await countRows(whereClause);
  let usedFuzzy = false;
  if (total === 0 && fuzzyFallback) {
    whereClause = compose(fuzzyFallback);
    total = await countRows(whereClause);
    usedFuzzy = true;
  }
  // Ce qu'on cherche en vain, compté pour l'administration : la première page,
  // un texte d'au moins trois caractères (une lettre en cours de frappe n'est
  // pas une recherche), et AUCUN autre filtre — « frieren » sous « mes
  // favoris » qui ne rend rien ne dit pas que Frieren manque au catalogue.
  const textOnly =
    !query.categoryId && !query.tag && !query.tagGroups && !query.imdbid && !query.tmdbid && !query.tvdbid &&
    !query.uploader && query.year === undefined && query.season === undefined && query.episode === undefined &&
    query.minSeeders === undefined && !query.freeleech && !query.notTaken && !query.hideSuperseded &&
    !query.favorites && !query.groupKey && !query.since;
  if (query.search && textOnly && query.page === 1 && total === 0) void recordSearchMiss(query.search, viewer.id);

  const orderByClause = buildTorrentOrderBy(query.sortBy, query.order, {
    rank: usedFuzzy ? rankFuzzy : rankExact,
  });
  const pinnedRows =
    query.page === 1
      ? await db.query.torrents.findMany({
          where: and(
            ...(searchCondition ? [...conditions, searchCondition] : conditions),
            eq(schema.torrents.isSticky, true),
          ),
          columns: { torrentData: false },
          with: { category: true, torrentTags: { with: { tag: true } } },
          orderBy: orderByClause,
          limit: MAX_PINNED,
        })
      : [];
  const torrents = await db.query.torrents.findMany({
    where: whereClause,
    columns: { torrentData: false },
    with: { category: true, torrentTags: { with: { tag: true } } },
    orderBy: orderByClause,
    limit: query.limit,
    offset,
  });

  const enriched = await enrichListing([...pinnedRows, ...torrents], viewer);
  return {
    pinned: enriched.slice(0, pinnedRows.length),
    data: enriched.slice(pinnedRows.length),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
    },
  };
});
