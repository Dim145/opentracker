/**
 * PATCH /api/admin/bonus-rules/rule/:kind
 *
 * Updates a single rule. Body accepts `enabled` and/or `config` —
 * config is validated against the kind-specific Zod schema before
 * persistence so a malformed payload can never reach the cron's
 * crediting path.
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import {
  BONUS_RULE_KINDS,
  validateBonusRuleConfig,
  type BonusRuleKind,
} from '~~/utils/bonusEarning';

const bodySchema = z
  .object({
    enabled: z.boolean().optional(),
    config: z.unknown().optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const kind = getRouterParam(event, 'kind') as BonusRuleKind | undefined;
  if (!kind || !BONUS_RULE_KINDS.includes(kind)) {
    throw createError({ statusCode: 400, message: 'Unknown rule kind' });
  }
  const body = await readValidatedBody(event, bodySchema.parse);

  const updates: Record<string, unknown> = {};
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.config !== undefined) {
    updates.config = validateBonusRuleConfig(kind, body.config);
  }
  if (Object.keys(updates).length === 0) {
    return { success: true, updated: 0 };
  }
  updates.updatedAt = new Date();

  const [row] = await db
    .update(schema.bonusRules)
    .set(updates)
    .where(eq(schema.bonusRules.kind, kind))
    .returning();
  if (!row) throw createError({ statusCode: 404, message: 'Rule not found' });

  return { success: true, rule: row };
});
