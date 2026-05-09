/**
 * POST /api/forum/categories
 *
 * Admin-only category creation. The newsroom redesign added two display
 * fields — `color` (hex accent) and `icon` (Phosphor id) — which let the
 * admin paint each category in the index page. Both are optional; the
 * frontend renders a neutral grey + list icon when they're empty.
 */
import { db } from '@trackarr/db';
import { forumCategories } from '@trackarr/db/schema';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateBody, forumCategorySchema } from '~~/utils/schemas';
import { v4 as uuidv4 } from 'uuid';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const body = await validateBody(event, forumCategorySchema);

  const [category] = await db
    .insert(forumCategories)
    .values({
      id: uuidv4(),
      name: body.name,
      description: body.description ?? null,
      color: body.color ?? null,
      icon: body.icon ?? null,
      order: body.order ?? 0,
    })
    .returning();

  return category;
});
