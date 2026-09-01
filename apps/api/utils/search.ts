/**
 * Catalogue full-text search.
 *
 * PostgreSQL does all the work: `to_tsvector` and GIN indexes have been in the
 * engine core since 8.3 — no extension to install, no service to deploy and
 * keep in sync. Measured over 200,000 releases, a weighted two-field search
 * with ranking costs 23 ms, against 213 ms for the unindexed
 * `LIKE '%term%'` it replaces.
 *
 * The delicate part is elsewhere: an expression index only serves the query
 * when the queried expression is the same as the indexed one. Both therefore
 * come from here — `ftsVector()` is called by `schema.ts` to build the indexes
 * and by the search route to query them. They cannot diverge.
 *
 * This module touches neither infohash search nor external-id search: both are
 * exact matches on dedicated columns, routed before free text.
 */
import { ftsVector, FTS_CONFIG } from '@trackarr/db';

// Re-exported so the search route only needs a single import.
export { ftsVector, FTS_CONFIG };

/** Champs qu'un opérateur peut activer. L'ordre fixe celui de l'interface. */
export const SEARCH_FIELDS = ['name', 'description', 'nfo', 'tags'] as const;
export type SearchField = (typeof SEARCH_FIELDS)[number];

/**
 * By default we search the title and the description. The NFO stays out of
 * scope: it is long, noisy text (file listings, ASCII art) that would drown the
 * relevant results with the user having no idea why. Tags are useful but cost a
 * join, so they are opt-in with eyes open.
 */
export const DEFAULT_SEARCH_FIELDS: SearchField[] = ['name', 'description'];

/** The `settings` key holding the list, as CSV. */
export const SEARCH_FIELDS_SETTING = 'search_fields';

export function parseSearchFields(raw: string | null | undefined): SearchField[] {
  if (raw === null || raw === undefined) return DEFAULT_SEARCH_FIELDS;
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is SearchField => (SEARCH_FIELDS as readonly string[]).includes(s));
  // An empty list is a legitimate operator choice ("search no free text at
  // all"), but an unreadable value must not disarm search.
  return raw.trim() === '' ? [] : parsed.length ? parsed : DEFAULT_SEARCH_FIELDS;
}

/** The `settings` key enabling the typo fallback. */
export const SEARCH_FUZZY_SETTING = 'search_fuzzy';

/**
 * Typo fallback: on by default.
 *
 * It is what saves an empty page for whoever types "crimsen" for "crimson", but
 * the `word_similarity` pass costs roughly ten times a full-text search (204 ms
 * against 52 over 200,000 rows). On a catalogue that has grown too large, or a
 * server under strain, an operator must be able to switch it off without
 * touching the rest of search — hence a setting separate from the scanned
 * fields.
 */
export function parseSearchFuzzy(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return true;
  return raw.trim().toLowerCase() !== 'false';
}

/**
 * A tsquery with prefix completion on the last term.
 *
 * The input is reduced to letters and digits before assembly: `to_tsquery`
 * interprets `&`, `|`, `!`, `:` and parentheses, and raw input would trigger a
 * syntax error on the slightest `(`. We are not trying to expose those
 * operators — a tracker search bar implies AND between words.
 *
 * Only the last term gets `:*`: that is the one the user is still typing.
 * Prefixing the earlier ones would widen the result for no reason.
 *
 * Returns `null` when nothing usable is left, in which case the caller must
 * skip the filter rather than return nothing.
 */
/**
 * The same normalisation WITHOUT the trailing `:*`.
 *
 * The prefix in `toPrefixTsQuery` exists because the member is still typing:
 * `crown` should match `crownfall` while the query bar has focus. A saved alert
 * is settled intent, and the same prefix there would fire "The Crown" on every
 * release whose title merely starts the same way — a false positive the member
 * has no way to see coming, arriving as a notification.
 *
 * Shares the term-splitting with the prefix version rather than repeating it,
 * so the two can never disagree about what counts as a term.
 */
export function toExactTsQuery(input: string): string | null {
  const prefixed = toPrefixTsQuery(input);
  if (!prefixed) return null;
  return prefixed.replace(/:\*$/, '');
}

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
 * A term usable for the typo fallback: a single word, long enough for trigram
 * similarity to mean anything. Below three characters there is no trigram at
 * all, and across several words the `<%` operator compares word to word without
 * saying anything about the combination.
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
