/** POST /api/admin/bonus-rules/tiers/age — append an age tier. */
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { v4 as uuidv4 } from 'uuid';
import { requireAdminSession } from '~~/utils/adminAuth';

const bodySchema = z
  .object({
    minAgeDays: z.number().int().nonnegative().max(36500), // 100y cap
    multiplier: z.number().int().nonnegative().max(10_000),
    enabled: z.boolean().optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const body = await readValidatedBody(event, bodySchema.parse);
  const [row] = await db
    .insert(schema.bonusAgeTiers)
    .values({
      id: uuidv4(),
      minAgeDays: body.minAgeDays,
      multiplier: body.multiplier,
      enabled: body.enabled ?? true,
    })
    .returning();
  return { tier: row };
});
