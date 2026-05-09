/**
 * PUT /api/forum/categories/[id]
 *
 * Admin-only category edit. Accepts a partial body — every field is
 * optional, so the admin can drop just an icon or repaint just the colour
 * without re-submitting the rest. Returns the freshly-updated row.
 */
import { db } from '@trackarr/db';
import { forumCategories } from '@trackarr/db/schema';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateBody, forumCategoryUpdateSchema } from '~~/utils/schemas';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Category ID is required',
    });
  }

  const body = await validateBody(event, forumCategoryUpdateSchema);

  const existing = await db.query.forumCategories.findFirst({
    where: eq(forumCategories.id, id),
  });

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Category not found',
    });
  }

  // Build a sparse SET object so undefined keys don't reset existing
  // values to NULL. Drizzle skips keys that aren't present.
  const set: Partial<typeof forumCategories.$inferInsert> = {};
  if (body.name !== undefined) set.name = body.name;
  if (body.description !== undefined) set.description = body.description;
  if (body.color !== undefined) set.color = body.color;
  if (body.icon !== undefined) set.icon = body.icon;
  if (body.order !== undefined) set.order = body.order;

  const [updated] = await db
    .update(forumCategories)
    .set(set)
    .where(eq(forumCategories.id, id))
    .returning();

  return updated;
});
