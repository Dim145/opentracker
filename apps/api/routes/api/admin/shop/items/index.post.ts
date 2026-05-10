/**
 * POST /api/admin/shop/items — create a new shop item.
 *
 * Body validates the (type, payload) pair through `validateItemPayload`
 * before the row is written, so a malformed payload can't reach the
 * purchase code path.
 */
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { v4 as uuidv4 } from 'uuid';
import {
  SHOP_ITEM_TYPES,
  validateItemPayload,
  type ShopItemType,
} from '~~/utils/shop';
import { requireAdminSession } from '~~/utils/adminAuth';

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional().nullable(),
    icon: z.string().trim().max(80).optional().nullable(),
    type: z.enum(SHOP_ITEM_TYPES),
    payload: z.unknown(),
    cost: z.number().int().positive().max(10_000_000),
    stock: z.number().int().nonnegative().optional().nullable(),
    enabled: z.boolean().optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const body = await readValidatedBody(event, bodySchema.parse);

  // Validate the payload against the type-specific schema before insert.
  const cleanPayload = validateItemPayload(
    body.type as ShopItemType,
    body.payload
  );

  const id = uuidv4();
  const [row] = await db
    .insert(schema.shopItems)
    .values({
      id,
      name: body.name,
      description: body.description ?? null,
      icon: body.icon ?? null,
      type: body.type,
      payload: cleanPayload,
      cost: body.cost,
      stock: body.stock ?? null,
      enabled: body.enabled ?? true,
    })
    .returning();

  return { item: row };
});
