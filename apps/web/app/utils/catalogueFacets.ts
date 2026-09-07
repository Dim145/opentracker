/**
 * Les types du rail de facettes, hors du composant : un `<script setup>` ne
 * peut pas exporter de valeur, et la page a besoin de la liste des options.
 */
export interface FacetsResponse {
  total: number;
  categories: Array<{ id: string; count: number }>;
  tags: Array<{ slug: string; name: string; count: number }>;
  /** Les mêmes comptes, le groupe i de `tagGroups` retiré : pour la famille qui l'a posé. */
  tagsByGroup?: Record<string, Array<{ slug: string; name: string; count: number }>>;
  years: Array<{ year: number; count: number }>;
  options: { withSeeders: number; freeleech: number; notTaken: number; superseded: number; favorites?: number };
  /** Dernière passe du collecteur d'essaims (`torrent_stats`), ISO ou null. */
  statsAt?: string | null;
  /** Quand rien ne sort : le compte sans chacun des critères posés. */
  dropOne?: Array<{ key: string; count: number }> | null;
  /** Le catalogue entier, visible par ce membre — quand rien ne sort. */
  catalogue?: number | null;
  /** Des titres d'œuvres proches du texte, par trigrammes — quand rien ne sort. */
  didYouMean?: Array<{ source: string; externalId: string; title: string }> | null;
}

export interface FacetCategory {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  subcategories?: FacetCategory[];
}

/** Les quatre options du rail, dans l'ordre d'affichage ; c'est aussi la valeur du paramètre `o`. */
export type OptionKey = 'seeded' | 'free' | 'untaken' | 'current' | 'favorites';
export const OPTION_KEYS: readonly OptionKey[] = ['seeded', 'free', 'untaken', 'current', 'favorites'];

/** Les facettes que le rail peut montrer ; l'opérateur choisit lesquelles. */
export const FACET_KEYS = ['category', 'resolution', 'source', 'codec', 'language', 'hdr', 'audio', 'year', 'options'] as const;
export type FacetKey = (typeof FACET_KEYS)[number];

/* ── La logique du rail, hors composant pour être testée ────────────────── */
export interface CategoryRow {
  id: string;
  name: string;
  count: number;
  kids: Array<{ id: string; name: string; count: number }>;
}

/**
 * Les catégories du rail : un parent compte ses enfants ; on ne montre que ce
 * qui a des releases sous la recherche courante, plus ce qui est coché ; les
 * plus fournies d'abord.
 */
export function categoryRows(
  categories: FacetCategory[],
  counts: Array<{ id: string; count: number }>,
  selected: string,
): CategoryRow[] {
  const byId = new Map(counts.map((c) => [c.id, c.count]));
  return categories
    .map((p) => {
      const kids = (p.subcategories ?? [])
        .map((s) => ({ id: s.id, name: s.name, count: byId.get(s.id) ?? 0 }))
        .filter((k) => k.count > 0 || k.id === selected)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      const count = (byId.get(p.id) ?? 0) + kids.reduce((acc, k) => acc + k.count, 0);
      return { id: p.id, name: p.name, count, kids };
    })
    .filter((p) => p.count > 0 || p.id === selected || p.kids.some((k) => k.id === selected))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Les lignes d'une famille d'étiquettes : celles de `tagsByGroup[i]` quand la
 * famille a posé le groupe i (comptée sans elle-même), les comptes stricts
 * sinon — puis filtrées à la famille et triées par compte.
 */
export function familyRows(
  facets: Pick<FacetsResponse, 'tags' | 'tagsByGroup'>,
  groupIndex: number,
  belongs: (slug: string) => boolean,
): Array<{ slug: string; name: string; count: number }> {
  const source = (groupIndex >= 0 ? facets.tagsByGroup?.[String(groupIndex)] : undefined) ?? facets.tags;
  return source.filter((tg) => belongs(tg.slug)).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
