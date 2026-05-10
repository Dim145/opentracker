/**
 * PATCH /api/admin/shop/items/:id — update a shop item.
 *
 * Every field is optional; only what's provided is touched. When
 * `type` or `payload` changes we re-validate the pair before write.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  SHOP_ITEM_TYPES,
  validateItemPayload,
  type ShopItemType,
} from '~~/utils/shop';
import { requireAdminSession } from '~~/utils/adminAuth';

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    icon: z.string().trim().max(80).nullable().optional(),
    type: z.enum(SHOP_ITEM_TYPES).optional(),
    payload: z.unknown().optional(),
    cost: z.number().int().positive().max(10_000_000).optional(),
    stock: z.number().int().nonnegative().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });
  const body = await readValidatedBody(event, bodySchema.parse);

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.icon !== undefined) updates.icon = body.icon;
  if (body.cost !== undefined) updates.cost = body.cost;
  if (body.stock !== undefined) updates.stock = body.stock;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  // type + payload travel together. We re-validate whenever either
  // shows up so the column never ends up holding a payload that
  // doesn't match its type.
  if (body.type !== undefined || body.payload !== undefined) {
    const [existing] = await db
      .select({ type: schema.shopItems.type, payload: schema.shopItems.payload })
      .from(schema.shopItems)
      .where(eq(schema.shopItems.id, id))
      .limit(1);
    if (!existing) {
      throw createError({ statusCode: 404, message: 'Item not found' });
    }
    const newType = (body.type ?? existing.type) as ShopItemType;
    const newPayload = body.payload ?? existing.payload;
    updates.type = newType;
    updates.payload = validateItemPayload(newType, newPayload);
  }

  if (Object.keys(updates).length === 0) {
    return { success: true, updated: 0 };
  }

  updates.updatedAt = new Date();

  const [row] = await db
    .update(schema.shopItems)
    .set(updates)
    .where(eq(schema.shopItems.id, id))
    .returning();

  if (!row) {
    throw createError({ statusCode: 404, message: 'Item not found' });
  }

  return { success: true, item: row };
});
