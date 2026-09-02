/**
 * L'URL de catalogue que rejoue une recherche enregistrée.
 *
 * Extrait de `pages/alerts.vue` pour être testable, parce que la panne qu'il a
 * connue était muette : `searchLink()` émettait `search` et `categoryId` — les
 * noms du corps envoyé à `/api/me/saved-searches` — alors que
 * `pages/torrents/index.vue` lit `q` et `c`. La loupe ouvrait donc un catalogue
 * sans aucun filtre, sans erreur ni trace, et la recherche enregistrée ne
 * s'appliquait jamais. Les quatre autres paramètres portaient déjà le bon nom,
 * ce qui rendait la panne d'autant plus difficile à voir.
 *
 * Deux vocabulaires se ressemblent ici et il ne faut pas les confondre :
 *
 *   critère stocké  →  paramètre d'URL lu par la page
 *   query           →  q
 *   categoryId      →  c
 *   tags[]          →  tag   (liste séparée par des virgules)
 *   imdbId          →  imdbid
 *   tmdbId          →  tmdbid
 *   tvdbId          →  tvdbid
 *
 * `p`, `s`, `d` et `v` relèvent de l'affichage — page, tri, sens, vue groupée —
 * et ne sont pas des critères : une recherche enregistrée n'en stocke aucun,
 * donc la page reprend ses valeurs par défaut.
 *
 * Nommée `savedSearchLink` et non `searchLink` : Nuxt auto-importe
 * `app/utils/`, et un nom générique de plus dans cet espace finit par entrer en
 * collision avec un autre — voir `useDraft.ts` pour le troisième doublon
 * rencontré de cette façon.
 */
export interface SavedSearchCriteria {
  query?: string | null;
  categoryId?: string | null;
  tags?: string[] | null;
  imdbId?: string | null;
  tmdbId?: string | null;
  tvdbId?: string | null;
}

export function savedSearchLink(s: SavedSearchCriteria): string {
  const q = new URLSearchParams();
  if (s.query) q.set('q', s.query);
  if (s.categoryId) q.set('c', s.categoryId);
  if (s.tags?.length) q.set('tag', s.tags.join(','));
  if (s.imdbId) q.set('imdbid', s.imdbId);
  if (s.tmdbId) q.set('tmdbid', s.tmdbId);
  if (s.tvdbId) q.set('tvdbid', s.tvdbId);
  const qs = q.toString();
  return qs ? `/torrents?${qs}` : '/torrents';
}
