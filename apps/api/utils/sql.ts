/**
 * Escape characters that act as wildcards in SQL LIKE / ILIKE patterns
 * so user-supplied search terms can be safely wrapped in `%…%`.
 *
 * Without escaping, a search for `100%` collapses to "match anything"
 * (silent recall corruption), and `_` matches any single character.
 * Backslash is escaped first because it's the default escape character
 * in Postgres LIKE syntax.
 */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
