/**
 * GET /api/admin/shop/items — admin catalogue listing.
 *
 * Returns every item, enabled or not, ordered by createdAt desc.
 * Includes the raw `type` + `payload` so the admin form can pre-fill
 * for editing.
 */
import { desc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const items = await db
    .select()
    .from(schema.shopItems)
    .orderBy(desc(schema.shopItems.createdAt));

  return { items };
});
