/**
 * Taxonomy bridge between a partner's category vocabulary and ours.
 *
 * A mirrored release is filed under the slug its origin chose. When both
 * instances share the conventional slug, the grouped browse filter matches it by
 * plain equality and there is nothing to do. When a partner names the same shelf
 * differently, the release falls out of every local category — invisible to a
 * member who filters by, say, "Films". {@link remoteCategoryMap} lets an operator
 * declare "this foreign slug is really our category X" once; the two helpers here
 * turn that declaration into (a) an extra branch on the browse filter and (b) a
 * slug → local-category resolution for display.
 *
 * Both are cheap: the map is a handful of rows keyed by a unique slug, dwarfed by
 * any mirror scan it rides alongside.
 */
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';

/**
 * Predicate: the current `remote_torrents` row's slug maps to one of `localIds`.
 *
 * Composed into the grouped browse filter *in addition to* the conventional
 * equality match, so a mapping only ever widens what a category shows, never
 * narrows it. References `remote_torrents.category_slug` by name, which is
 * correct because every read path scans the real table (aliased in JS, never in
 * SQL) — the same contract the mask predicate relies on.
 */
export function remoteCategoryFilter(localIds: string[]): SQL {
  if (!localIds.length) return sql`false`;
  return sql`EXISTS (
    SELECT 1 FROM ${schema.remoteCategoryMap} cm
     WHERE cm.remote_slug = ${schema.remoteTorrents.categorySlug}
       AND cm.local_category_id IN (${sql.join(
         localIds.map((id) => sql`${id}`),
         sql`, `,
       )})
  )`;
}

export interface ResolvedCategory {
  categoryId: string;
  name: string;
  slug: string;
}

/**
 * Resolve foreign slugs to the local categories they map to.
 *
 * Returns only the slugs that have a mapping; an unmapped slug is simply absent
 * from the map, so a caller falls back to showing the raw token. One indexed
 * lookup regardless of how many slugs are asked for.
 */
export async function resolveRemoteSlugs(
  slugs: string[],
): Promise<Map<string, ResolvedCategory>> {
  const unique = [...new Set(slugs.filter((s): s is string => !!s))];
  if (!unique.length) return new Map();
  const rows = await db
    .select({
      remoteSlug: schema.remoteCategoryMap.remoteSlug,
      categoryId: schema.categories.id,
      name: schema.categories.name,
      slug: schema.categories.slug,
    })
    .from(schema.remoteCategoryMap)
    .innerJoin(
      schema.categories,
      eq(schema.categories.id, schema.remoteCategoryMap.localCategoryId),
    )
    .where(inArray(schema.remoteCategoryMap.remoteSlug, unique));
  return new Map(
    rows.map((r) => [
      r.remoteSlug,
      { categoryId: r.categoryId, name: r.name, slug: r.slug },
    ]),
  );
}

/**
 * Declare (or re-point) the mapping for one foreign slug. Idempotent on the
 * slug: mapping it again just updates the target. Returns the row id.
 */
export async function setRemoteCategoryMapping(
  remoteSlug: string,
  localCategoryId: string,
  createdBy: string | null = null,
): Promise<string> {
  const id = randomUUID();
  const [row] = await db
    .insert(schema.remoteCategoryMap)
    .values({ id, remoteSlug, localCategoryId, createdBy })
    .onConflictDoUpdate({
      target: schema.remoteCategoryMap.remoteSlug,
      set: { localCategoryId, createdBy },
    })
    .returning({ id: schema.remoteCategoryMap.id });
  return row!.id;
}

/** Drop a mapping by id. The foreign slug reverts to raw display next read. */
export async function clearRemoteCategoryMapping(id: string): Promise<boolean> {
  const gone = await db
    .delete(schema.remoteCategoryMap)
    .where(eq(schema.remoteCategoryMap.id, id))
    .returning({ id: schema.remoteCategoryMap.id });
  return gone.length > 0;
}
