/**
 * GET /api/admin/federation/taxonomy
 *
 * The taxonomy console: every declared mapping (foreign slug → local category)
 * resolved to real names, the worklist of foreign slugs still seen on the mirror
 * with no mapping, and the local category tree to pick from. One screen an
 * operator uses to teach the browse filter that a partner's "films" is our
 * "Movies".
 */
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const mappings = await db
    .select({
      id: schema.remoteCategoryMap.id,
      remoteSlug: schema.remoteCategoryMap.remoteSlug,
      categoryId: schema.categories.id,
      categoryName: schema.categories.name,
      categorySlug: schema.categories.slug,
      createdAt: schema.remoteCategoryMap.createdAt,
    })
    .from(schema.remoteCategoryMap)
    .innerJoin(
      schema.categories,
      eq(schema.categories.id, schema.remoteCategoryMap.localCategoryId),
    )
    .orderBy(asc(schema.remoteCategoryMap.remoteSlug));

  // Foreign slugs present on the mirror that nobody has mapped yet — the
  // operator's to-do list, heaviest first so the categories that matter most get
  // bridged first. Bounded: a mirror can carry a long tail of one-off slugs.
  const unmapped = await db
    .select({
      slug: schema.remoteTorrents.categorySlug,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.remoteTorrents)
    .where(
      and(
        isNotNull(schema.remoteTorrents.categorySlug),
        sql`NOT EXISTS (SELECT 1 FROM ${schema.remoteCategoryMap} cm WHERE cm.remote_slug = ${schema.remoteTorrents.categorySlug})`,
      ),
    )
    .groupBy(schema.remoteTorrents.categorySlug)
    .orderBy(sql`count(*) DESC`)
    .limit(200);

  const categories = await db
    .select({
      id: schema.categories.id,
      name: schema.categories.name,
      slug: schema.categories.slug,
      type: schema.categories.type,
      parentId: schema.categories.parentId,
      isAdult: schema.categories.isAdult,
    })
    .from(schema.categories)
    .orderBy(asc(schema.categories.name));

  return { mappings, unmapped, categories };
});
