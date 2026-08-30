import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  // Require admin authentication
  await requireAdminSession(event);

  const id = getRouterParam(event, 'id');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Category ID is required',
    });
  }

  // Check if there are torrents in this category
  const torrentCount = await db.query.torrents.findFirst({
    where: (t, { eq }) => eq(t.categoryId, id),
  });

  if (torrentCount) {
    throw createError({
      statusCode: 400,
      message: 'Cannot delete category with torrents',
    });
  }

  // Check if this category has subcategories
  const subcategory = await db.query.categories.findFirst({
    where: eq(schema.categories.parentId, id),
  });

  if (subcategory) {
    throw createError({
      statusCode: 400,
      message:
        'Cannot delete category with subcategories. Delete subcategories first.',
    });
  }

  await db.delete(schema.categories).where(eq(schema.categories.id, id));

  // The adult-category list is cached in process for a minute, so a
  // category flagged here would not actually be hidden until the TTL
  // rolled over — an operator marking a subtree adult and watching it
  // stay visible for the next sixty seconds, with nothing saying why.
  // The invalidator existed for exactly this and nothing called it.
  //
  // Per-process, so on a multi-replica deployment the others still wait
  // out the TTL. That is what the TTL is for; this removes the wait on
  // the replica the operator is actually looking at.
  invalidateAdultCategoryCache();
  return { success: true };
});
