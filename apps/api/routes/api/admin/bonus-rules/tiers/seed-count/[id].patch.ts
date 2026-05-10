/** PATCH /api/admin/bonus-rules/tiers/seed-count/:id — update a tier. */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';

const bodySchema = z
  .object({
    maxSeeders: z.number().int().nonnegative().max(1_000_000).optional(),
    multiplier: z.number().int().nonnegative().max(10_000).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });
  const body = await readValidatedBody(event, bodySchema.parse);
  const [row] = await db
    .update(schema.bonusSeedCountTiers)
    .set(body)
    .where(eq(schema.bonusSeedCountTiers.id, id))
    .returning();
  if (!row) throw createError({ statusCode: 404, message: 'Tier not found' });
  return { tier: row };
});
