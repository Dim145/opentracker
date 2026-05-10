/**
 * POST /api/admin/bonus-rules/tiers/seed-count
 *
 * Append a new seeder-count tier. The cron picks it up on the next
 * tick — no restart needed.
 */
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { v4 as uuidv4 } from 'uuid';
import { requireAdminSession } from '~~/utils/adminAuth';

const bodySchema = z
  .object({
    maxSeeders: z.number().int().nonnegative().max(1_000_000),
    multiplier: z.number().int().nonnegative().max(10_000),
    enabled: z.boolean().optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const body = await readValidatedBody(event, bodySchema.parse);
  const [row] = await db
    .insert(schema.bonusSeedCountTiers)
    .values({
      id: uuidv4(),
      maxSeeders: body.maxSeeders,
      multiplier: body.multiplier,
      enabled: body.enabled ?? true,
    })
    .returning();
  return { tier: row };
});
