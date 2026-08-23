/**
 * The full-text expression shared between the schema and the queries.
 *
 * An expression index only serves a query when the queried expression is the
 * same as the indexed one. Both therefore come from here: `schema.ts` calls
 * `ftsVector()` to declare the GIN indexes, the search route calls it to build
 * its predicate. They cannot diverge.
 *
 * Expression indexes rather than `GENERATED … STORED` columns, because a
 * stored column would duplicate in the table a vector the index already holds,
 * for no gain: the predicate is built from the same expression, so the index is
 * used either way.
 *
 * (The original reason given here was that the API pushed `schema.ts` at boot
 * and push handled indexes better than generated columns. That mechanism is
 * gone — the boot applies committed migrations — and the choice stands on its
 * own, so the reason has been replaced rather than deleted.)
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

/**
 * Configuration `simple`, not `french`: a release name is not prose. The
 * stemmer would reduce "Remux", "Extended" or "Complete" unpredictably, and the
 * language changes from one release to the next. `simple` tokenises and folds
 * case, which is what a multilingual catalogue wants.
 */
export const FTS_CONFIG = 'simple';

/**
 * The indexed vector for one column.
 *
 * `coalesce` is part of the expression, not a writing convenience: without it a
 * NULL column would produce a NULL vector, the row would drop out of the index,
 * and the query could no longer use it.
 */
export function ftsVector(column: AnyColumn | SQL): SQL {
  // `sql.raw` is REQUIRED here and must stay. This same expression is what
  // `schema.ts` emits as the GIN index definition, and an index expression
  // has to be immutable and literal — a bound parameter is invalid DDL, and
  // even in the query position it would stop the planner from matching the
  // indexed expression, silently turning every search into a sequential scan.
  // `FTS_CONFIG` is a module constant, never user input.
  return sql`to_tsvector(${sql.raw(`'${FTS_CONFIG}'`)}, coalesce(${column}, ''))`;
}
