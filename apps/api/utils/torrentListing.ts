import { db, schema } from '@trackarr/db';
import { and, eq, gt, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { getStats } from '~~/utils/server';
import { slugifyTag, tagFilterCondition } from '~~/utils/tags';
import { normalizeMediaId, tmdbIdBare } from '~~/utils/mediaIds';
import { getSetting } from '~~/utils/settings';
import {
  FTS_CONFIG,
  SEARCH_FIELDS_SETTING,
  SEARCH_FUZZY_SETTING,
  ftsVector,
  fuzzyTerm,
  parseSearchFields,
  parseSearchFuzzy,
  toPrefixTsQuery,
} from '~~/utils/search';
import { adultCategoryIds } from '~~/utils/adultContent';
import { worksFromCache, workRefKey, type CachedWork, type WorkRef } from '~~/utils/metadata/cached';
import { groupMemberWhere, parseGroupKey } from '~~/utils/torrentGroups';

/**
 * Le listing des torrents, en pièces réutilisables.
 *
 * Le listing plat et la vue groupée ont chacun réécrit les mêmes prédicats, et
 * la vue groupée a un jour PERDU le filtre par tag sans qu'aucune ligne ne le
 * dise. Depuis, les conditions vivent ici, une fois : la visibilité (modération,
 * actif, contenu adulte), les filtres que la barre du catalogue produit, la
 * recherche plein texte. Les comptes par facette, à venir, les liront aussi.
 */
export interface ListingViewer {
  id: string;
  isAdmin?: boolean;
  isModerator?: boolean;
  language?: string | null;
}

export interface ListingFilters {
  categoryId?: string;
  tag?: string;
  tagGroups?: string;
  imdbid?: string;
  tmdbid?: string;
  tvdbid?: string;
  uploader?: string;
  year?: number;
  season?: number;
  episode?: number;
  minSeeders?: number;
  freeleech?: string;
  notTaken?: string;
  hideSuperseded?: string;
  groupKey?: string;
}

/** `1`/`true` dans une chaîne de requête, et rien d'autre. */
export const isFlag = (v: unknown): boolean => v === '1' || v === 'true' || v === true;

/** Ce que ce membre a le droit de voir : modération, activité, contenu adulte. */
export async function visibilityConditions(viewer: ListingViewer): Promise<SQL[]> {
  const conditions: SQL[] = [];
  const canSeeUnapproved = !!viewer.isAdmin || !!viewer.isModerator;
  if (!canSeeUnapproved) {
    conditions.push(
      or(eq(schema.torrents.moderationStatus, 'accepted'), eq(schema.torrents.uploaderId, viewer.id))!,
    );
    conditions.push(eq(schema.torrents.isActive, true));
  }
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, viewer.id),
    columns: { showAdultContent: true },
  });
  if (!(me?.showAdultContent ?? false)) {
    const adultIds = await adultCategoryIds();
    if (adultIds.length > 0) {
      conditions.push(
        or(isNull(schema.torrents.categoryId), notInArray(schema.torrents.categoryId, adultIds))!,
      );
    }
  }
  return conditions;
}

/**
 * `hevc,x265;1080p` → (hevc OU x265) ET 1080p. Chaque groupe est un EXISTS sur
 * la table de liaison ; un slug inconnu ne correspond à rien, sans forcer le
 * vide comme `tag` le fait (là, un slug qui n'existe pas est une erreur de
 * frappe ; ici, ce sont des synonymes dont seuls certains existent).
 */
export function tagGroupsCondition(raw: string): SQL | null {
  const groups = raw
    .split(';')
    .map((g) => Array.from(new Set(g.split(',').map((s) => slugifyTag(s)).filter(Boolean))))
    .filter((g) => g.length > 0);
  if (groups.length === 0) return null;
  const parts = groups.map(
    (slugs) => sql`EXISTS (
      SELECT 1 FROM ${schema.torrentTags} tt
      JOIN ${schema.tags} tg ON tg.id = tt.tag_id
      WHERE tt.torrent_id = ${schema.torrents.id}
        AND tg.slug IN (${sql.join(slugs.map((s) => sql`${s}`), sql`, `)})
    )`,
  );
  return parts.length === 1 ? parts[0]! : and(...parts)!;
}

/** Les filtres explicites — catégorie, identifiants, tags, et ceux de la barre. */
export async function filterConditions(q: ListingFilters, viewer: ListingViewer): Promise<SQL[]> {
  const conditions: SQL[] = [];
  if (q.categoryId) {
    const subcategories = await db.query.categories.findMany({
      where: eq(schema.categories.parentId, q.categoryId),
      columns: { id: true },
    });
    conditions.push(
      or(
        eq(schema.torrents.categoryId, q.categoryId),
        ...subcategories.map((sub) => eq(schema.torrents.categoryId, sub.id)),
      )!,
    );
  }
  if (q.imdbid) {
    const norm = normalizeMediaId('imdb', q.imdbid);
    conditions.push(norm ? eq(schema.torrents.imdbId, norm) : sql`false`);
  }
  if (q.tmdbid) {
    const norm = normalizeMediaId('tmdb', q.tmdbid);
    const bare = norm ? tmdbIdBare(norm) : null;
    conditions.push(
      norm && bare
        ? or(
            eq(schema.torrents.tmdbId, norm),
            eq(schema.torrents.tmdbId, bare),
            eq(schema.torrents.tmdbId, `movie/${bare}`),
            eq(schema.torrents.tmdbId, `tv/${bare}`),
          )!
        : sql`false`,
    );
  }
  if (q.tvdbid) {
    const norm = normalizeMediaId('tvdb', q.tvdbid);
    conditions.push(norm ? eq(schema.torrents.tvdbId, norm) : sql`false`);
  }
  if (q.tag) {
    const cond = await tagFilterCondition(q.tag);
    if (cond) conditions.push(cond);
  }
  if (q.tagGroups) {
    const cond = tagGroupsCondition(q.tagGroups);
    if (cond) conditions.push(cond);
  }
  if (q.uploader) {
    conditions.push(
      sql`${schema.torrents.uploaderId} IN (SELECT u.id FROM ${schema.users} u WHERE lower(u.username) = ${q.uploader.toLowerCase()})`,
    );
  }
  if (typeof q.year === 'number') {
    // Pas de colonne « année » : c'est le nom qui la porte, entre deux
    // non-chiffres pour que 2023 ne trouve pas 12023 ni x20230.
    conditions.push(sql`${schema.torrents.name} ~ ${`(^|[^0-9])${q.year}([^0-9]|$)`}`);
  }
  if (typeof q.season === 'number') conditions.push(eq(schema.torrents.season, q.season));
  if (typeof q.episode === 'number') conditions.push(eq(schema.torrents.episode, q.episode));
  if (typeof q.minSeeders === 'number' && q.minSeeders > 0) {
    conditions.push(
      sql`COALESCE((SELECT s.seeders FROM torrent_stats s WHERE s.info_hash = ${schema.torrents.infoHash}), 0) >= ${q.minSeeders}`,
    );
  }
  if (isFlag(q.freeleech)) {
    conditions.push(
      and(
        eq(schema.torrents.downloadMultiplier, 0),
        or(isNull(schema.torrents.multipliersUntil), gt(schema.torrents.multipliersUntil, sql`now()`))!,
      )!,
    );
  }
  if (isFlag(q.notTaken)) {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM ${schema.hnrTracking} h WHERE h.user_id = ${viewer.id} AND h.torrent_id = ${schema.torrents.id} AND h.downloaded > 0)`,
    );
  }
  if (isFlag(q.hideSuperseded)) conditions.push(isNull(schema.torrents.supersededById));
  if (q.groupKey) conditions.push(groupMemberWhere(parseGroupKey(q.groupKey)));
  return conditions;
}

/** La recherche plein texte : le prédicat principal, et le repli approximatif. */
export async function searchConditions(
  search: string | undefined,
): Promise<{ primary: SQL | null; fuzzy: SQL | null }> {
  if (!search) return { primary: null, fuzzy: null };
  if (/^[0-9a-fA-F]{40}$/.test(search)) {
    return { primary: eq(schema.torrents.infoHash, search.toLowerCase()), fuzzy: null };
  }
  const fields = parseSearchFields(await getSetting(SEARCH_FIELDS_SETTING));
  const tsq = toPrefixTsQuery(search);
  if (!tsq) return { primary: null, fuzzy: null };
  if (!fields.length) return { primary: sql`false`, fuzzy: null };
  const q = sql`to_tsquery(${FTS_CONFIG}, ${tsq})`;
  const branches: SQL[] = [];
  if (fields.includes('name')) branches.push(sql`${ftsVector(schema.torrents.name)} @@ ${q}`);
  if (fields.includes('description')) branches.push(sql`${ftsVector(schema.torrents.description)} @@ ${q}`);
  if (fields.includes('nfo')) branches.push(sql`${ftsVector(schema.torrents.nfo)} @@ ${q}`);
  if (fields.includes('tags')) {
    branches.push(sql`EXISTS (
      SELECT 1 FROM ${schema.torrentTags} tt
      JOIN ${schema.tags} tg ON tg.id = tt.tag_id
      WHERE tt.torrent_id = ${schema.torrents.id}
        AND ${ftsVector(sql`tg.name`)} @@ ${q}
    )`);
  }
  const primary = branches.length > 1 ? or(...branches)! : branches[0]!;
  const term = fuzzyTerm(search);
  const fuzzy =
    term && parseSearchFuzzy(await getSetting(SEARCH_FUZZY_SETTING))
      ? sql`${term} <% ${schema.torrents.name}`
      : null;
  return { primary, fuzzy };
}

/* ── L'enrichissement d'une page de lignes ─────────────────────────────────── */

type Row = {
  id: string;
  infoHash: string;
  uploaderId: string | null;
  tmdbId: string | null;
  igdbId: string | null;
  openlibraryId: string | null;
  downloadMultiplier: number;
  multipliersUntil: Date | string | null;
  torrentTags?: Array<{ tag: unknown }> | null;
  [k: string]: unknown;
};

function workRefOf(row: Row): WorkRef | null {
  if (row.tmdbId) return { source: 'tmdb', id: row.tmdbId };
  if (row.igdbId) return { source: 'igdb', id: row.igdbId };
  if (row.openlibraryId) return { source: 'openlibrary', id: row.openlibraryId };
  return null;
}

/**
 * Ce qu'une ligne du catalogue dit de plus qu'une ligne de la table : l'essaim
 * vivant, si ce membre l'a en favori, s'il l'a DÉJÀ PRISE (des octets sur son
 * suivi de seed), qui l'a envoyée, si elle est gratuite en ce moment, et l'œuvre
 * telle que le cache la connaît. Cinq lectures pour la page, jamais par ligne.
 */
export async function enrichListing<T extends Row>(rows: T[], viewer: ListingViewer) {
  if (rows.length === 0) return [] as Array<T & EnrichmentFields>;
  const ids = rows.map((r) => r.id);
  const uids = Array.from(new Set(rows.map((r) => r.uploaderId).filter((u): u is string => !!u)));
  const favQ: Promise<Array<{ torrentId: string }>> = db
    .select({ torrentId: schema.torrentFavorites.torrentId })
    .from(schema.torrentFavorites)
    .where(and(eq(schema.torrentFavorites.userId, viewer.id), inArray(schema.torrentFavorites.torrentId, ids)));
  const takenQ: Promise<Array<{ torrentId: string }>> = db
    .select({ torrentId: schema.hnrTracking.torrentId })
    .from(schema.hnrTracking)
    .where(
      and(
        eq(schema.hnrTracking.userId, viewer.id),
        inArray(schema.hnrTracking.torrentId, ids),
        gt(schema.hnrTracking.downloaded, 0),
      ),
    );
  const uploadersQ: Promise<Array<{ id: string; username: string }>> = uids.length
    ? db.select({ id: schema.users.id, username: schema.users.username }).from(schema.users).where(inArray(schema.users.id, uids))
    : Promise.resolve([]);
  const [settled, favRows, takenRows, uploaderRows, works] = await Promise.all([
    Promise.allSettled(rows.map((r) => getStats(r.infoHash))),
    favQ,
    takenQ,
    uploadersQ,
    worksFromCache(
      Array.from(new Map(rows.map(workRefOf).filter((w): w is WorkRef => !!w).map((w) => [workRefKey(w), w])).values()),
      viewer.language ?? undefined,
    ),
  ]);
  const favorited = new Set(favRows.map((r) => r.torrentId));
  const taken = new Set(takenRows.map((r) => r.torrentId));
  const uploaders = new Map(uploaderRows.map((u) => [u.id, u.username]));
  const now = Date.now();
  return rows.map((row, i) => {
    const r = settled[i];
    const stats = r && r.status === 'fulfilled' ? r.value : { seeders: 0, leechers: 0, completed: 0 };
    const until = row.multipliersUntil ? new Date(row.multipliersUntil).getTime() : null;
    const ref = workRefOf(row);
    return {
      ...row,
      torrentTags: undefined,
      tags: (row.torrentTags ?? []).map((tt) => tt.tag),
      stats: { seeders: stats.seeders, leechers: stats.leechers, completed: stats.completed },
      viewerFavorited: favorited.has(row.id),
      viewerTaken: taken.has(row.id),
      uploader: row.uploaderId ? { id: row.uploaderId, username: uploaders.get(row.uploaderId) ?? null } : null,
      freeleech: row.downloadMultiplier === 0 && (until === null || until > now),
      work: ref ? works.get(workRefKey(ref)) ?? null : null,
    } as T & EnrichmentFields;
  });
}

export interface EnrichmentFields {
  tags: unknown[];
  stats: { seeders: number; leechers: number; completed: number };
  viewerFavorited: boolean;
  viewerTaken: boolean;
  uploader: { id: string; username: string | null } | null;
  freeleech: boolean;
  work: CachedWork | null;
}
