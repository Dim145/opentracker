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
  options: { withSeeders: number; freeleech: number; notTaken: number; superseded: number };
  /** Dernière passe du collecteur d'essaims (`torrent_stats`), ISO ou null. */
  statsAt?: string | null;
  /** Quand rien ne sort : le compte sans chacun des critères posés. */
  dropOne?: Array<{ key: string; count: number }> | null;
  /** Le catalogue entier, visible par ce membre — quand rien ne sort. */
  catalogue?: number | null;
}

export interface FacetCategory {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  subcategories?: FacetCategory[];
}

/** Les quatre options du rail, dans l'ordre d'affichage ; c'est aussi la valeur du paramètre `o`. */
export type OptionKey = 'seeded' | 'free' | 'untaken' | 'current';
export const OPTION_KEYS: readonly OptionKey[] = ['seeded', 'free', 'untaken', 'current'];
