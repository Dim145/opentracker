/**
 * PATCH /api/admin/freeleech-pool/config — update the singleton.
 *
 * Toggling `enabled = true` while no open cycle exists doesn't
 * eagerly spawn one — the first contribution will create the
 * cycle. This keeps the "freshly enabled, nobody contributed yet"
 * state visible in the admin dashboard as "no active cycle"
 * instead of an empty zero-progress placeholder.
 *
 * `pointsTarget` / `freeleechDurationDays` changes only affect
 * cycles created *after* the change — already-open cycles carry
 * their own snapshots so contributors aren't blindsided.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateBody } from '~~/utils/schemas';
import {
  DURATION_DAYS_MAX,
  FreeleechPoolError,
  MAX_PER_USER_BP_MAX,
  POINTS_TARGET_MAX,
  POOL_CONFIG_ID,
  getConfig,
  validateConfigPatch,
} from '~~/utils/freeleechPool';

const bodySchema = z
  .object({
    enabled: z.boolean().optional(),
    pointsTarget: z.number().int().min(0).max(POINTS_TARGET_MAX).optional(),
    freeleechDurationDays: z
      .number()
      .int()
      .min(1)
      .max(DURATION_DAYS_MAX)
      .optional(),
    contributionMin: z.number().int().min(1).optional(),
    maxPerUserBp: z.number().int().min(0).max(MAX_PER_USER_BP_MAX).optional(),
    presetAmounts: z.array(z.number().int().positive()).max(8).optional(),
    eventTitleTemplate: z.string().max(120).nullish(),
    eventDescriptionTemplate: z.string().max(500).nullish(),
    eventLongDescriptionTemplate: z.string().max(2000).nullish(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const body = await validateBody(event, bodySchema);

  // Make sure the singleton row exists.
  await getConfig();

  try {
    validateConfigPatch(body);
  } catch (err) {
    if (err instanceof FreeleechPoolError) {
      throw createError({ statusCode: err.statusCode, message: err.message });
    }
    throw err;
  }

  // Build the update set explicitly so undefined keys don't clobber
  // existing values via Drizzle's behaviour with `set({ x: undefined })`.
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (body.enabled !== undefined) update.enabled = body.enabled;
  if (body.pointsTarget !== undefined) update.pointsTarget = body.pointsTarget;
  if (body.freeleechDurationDays !== undefined) {
    update.freeleechDurationDays = body.freeleechDurationDays;
  }
  if (body.contributionMin !== undefined) {
    update.contributionMin = body.contributionMin;
  }
  if (body.maxPerUserBp !== undefined) update.maxPerUserBp = body.maxPerUserBp;
  if (body.presetAmounts !== undefined) {
    update.presetAmounts = body.presetAmounts;
  }
  if (body.eventTitleTemplate !== undefined) {
    update.eventTitleTemplate = body.eventTitleTemplate ?? null;
  }
  if (body.eventDescriptionTemplate !== undefined) {
    update.eventDescriptionTemplate = body.eventDescriptionTemplate ?? null;
  }
  if (body.eventLongDescriptionTemplate !== undefined) {
    update.eventLongDescriptionTemplate =
      body.eventLongDescriptionTemplate ?? null;
  }

  await db
    .update(schema.freeleechPoolConfig)
    .set(update)
    .where(eq(schema.freeleechPoolConfig.id, POOL_CONFIG_ID));

  const config = await getConfig();
  return { config };
});
