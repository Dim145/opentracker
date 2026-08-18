/**
 * Recherche plein-texte du catalogue.
 *
 * PostgreSQL fait tout le travail : `to_tsvector` et les index GIN sont dans le
 * cœur du moteur depuis la 8.3, aucune extension à installer, aucun service à
 * déployer et à tenir synchronisé. Mesuré sur 200 000 releases, une recherche
 * pondérée sur deux champs avec classement coûte 23 ms, contre 213 ms pour le
 * `LIKE '%terme%'` non indexé qu'elle remplace.
 *
 * Le point délicat est ailleurs : un index d'expression ne sert la requête que
 * si l'expression interrogée est la même que l'expression indexée. Les deux
 * sortent donc d'ici — `ftsVector()` est appelée par `schema.ts` pour bâtir les
 * index et par la route de recherche pour les interroger. Elles ne peuvent pas
 * diverger.
 *
 * Ce module ne touche ni la recherche par infohash ni celle par identifiant
 * externe : toutes deux sont des égalités exactes sur des colonnes dédiées,
 * aiguillées en amont du texte libre.
 */
import { ftsVector, FTS_CONFIG } from '@trackarr/db';

// Réexportés pour que la route de recherche n'ait qu'un seul import à faire.
export { ftsVector, FTS_CONFIG };

/** Champs qu'un opérateur peut activer. L'ordre fixe celui de l'interface. */
export const SEARCH_FIELDS = ['name', 'description', 'nfo', 'tags'] as const;
export type SearchField = (typeof SEARCH_FIELDS)[number];

/**
 * Par défaut on cherche le titre et la description. Le NFO reste hors du
 * périmètre : c'est du texte long et bruyant (listings de fichiers, ASCII art),
 * qui noierait les résultats pertinents sans que l'utilisateur comprenne
 * pourquoi. Les tags sont utiles mais coûtent une jointure, donc à activer en
 * connaissance de cause.
 */
export const DEFAULT_SEARCH_FIELDS: SearchField[] = ['name', 'description'];

/** Clé de `settings` portant la liste, en CSV. */
export const SEARCH_FIELDS_SETTING = 'search_fields';

export function parseSearchFields(raw: string | null | undefined): SearchField[] {
  if (raw === null || raw === undefined) return DEFAULT_SEARCH_FIELDS;
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is SearchField => (SEARCH_FIELDS as readonly string[]).includes(s));
  // Une liste vide est un choix légitime de l'opérateur (« ne rien chercher en
  // texte libre »), mais une valeur illisible ne doit pas désarmer la recherche.
  return raw.trim() === '' ? [] : parsed.length ? parsed : DEFAULT_SEARCH_FIELDS;
}

/** Clé de `settings` activant le repli sur faute de frappe. */
export const SEARCH_FUZZY_SETTING = 'search_fuzzy';

/**
 * Repli sur faute de frappe : actif par défaut.
 *
 * C'est ce qui évite une page vide à qui tape « crimsen » pour « crimson », mais
 * la passe `word_similarity` coûte environ dix fois une recherche plein-texte
 * (204 ms contre 52 sur 200 000 lignes). Sur un catalogue devenu trop gros ou un
 * serveur sous tension, un opérateur doit pouvoir la couper sans toucher au
 * reste de la recherche — d'où un réglage distinct des champs balayés.
 */
export function parseSearchFuzzy(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return true;
  return raw.trim().toLowerCase() !== 'false';
}

/**
 * Requête tsquery avec complétion sur le dernier terme.
 *
 * L'entrée est réduite aux lettres et aux chiffres avant d'être assemblée :
 * `to_tsquery` interprète `&`, `|`, `!`, `:` et les parenthèses, et une saisie
 * brute y déclencherait une erreur de syntaxe sur le moindre `(`. On ne cherche
 * pas à exposer ces opérateurs — une barre de recherche de tracker attend un
 * ET implicite entre les mots.
 *
 * Seul le dernier terme reçoit `:*` : c'est celui que l'utilisateur est en train
 * de taper. Préfixer les précédents élargirait le résultat sans raison.
 *
 * Rend `null` quand il ne reste rien d'exploitable, auquel cas l'appelant doit
 * s'abstenir de filtrer plutôt que de ne rien renvoyer.
 */
export function toPrefixTsQuery(input: string): string | null {
  const terms = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return null;
  return terms
    .map((term, i) => (i === terms.length - 1 ? `${term}:*` : term))
    .join(' & ');
}

/**
 * Terme utilisable pour le repli sur faute de frappe : un seul mot, assez long
 * pour que la similarité trigramme ait un sens. En dessous de trois caractères
 * un trigramme n'existe pas, et sur plusieurs mots l'opérateur `<%` compare mot
 * à mot sans rendre la main sur la combinaison.
 */
export function fuzzyTerm(input: string): string | null {
  const terms = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length !== 1) return null;
  const term = terms[0]!;
  return term.length >= 3 ? term : null;
}
