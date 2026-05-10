/**
 * DELETE /api/admin/shop/items/:id — remove a shop item.
 *
 * The schema's foreign key from `shop_purchases.item_id` uses
 * `ON DELETE RESTRICT`, so a delete fails if any historical purchase
 * still references the item. The admin should disable instead — or
 * accept the FK error and dig out the orphan rows manually.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  try {
    const result = await db
      .delete(schema.shopItems)
      .where(eq(schema.shopItems.id, id));
    return { success: true, deleted: (result as { rowCount?: number })?.rowCount ?? 1 };
  } catch (err: any) {
    // Postgres FK violation surfaces as code '23503'. Map to a
    // friendlier 409 + hint so the admin knows to disable instead.
    if (err?.code === '23503') {
      throw createError({
        statusCode: 409,
        message:
          'Cannot delete: this item has purchase history. Disable it instead.',
      });
    }
    throw err;
  }
});
