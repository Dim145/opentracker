/**
 * GET /api/admin/bonus-rules
 *
 * Returns the full bonus-earning configuration in one round-trip:
 *   - every rule (kind, enabled, config), in BONUS_RULE_KINDS order
 *   - every seed-count tier, ordered by max_seeders ASC
 *   - every age tier, ordered by min_age_days ASC
 *
 * The admin UI mounts a single `<BonusRules />` component on this
 * payload — keeping the read in one shot avoids a flicker between
 * the rule list and the two tier tables.
 */
import { asc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { BONUS_RULE_KINDS, type BonusRuleKind } from '~~/utils/bonusEarning';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const rulesRaw = await db.select().from(schema.bonusRules);
  const seedCountTiers = await db
    .select()
    .from(schema.bonusSeedCountTiers)
    .orderBy(asc(schema.bonusSeedCountTiers.maxSeeders));
  const ageTiers = await db
    .select()
    .from(schema.bonusAgeTiers)
    .orderBy(asc(schema.bonusAgeTiers.minAgeDays));

  // Sort rules by the canonical kind order so the UI doesn't have to.
  const ruleByKind = new Map(rulesRaw.map((r) => [r.kind, r]));
  const rules = BONUS_RULE_KINDS.map((kind) => ruleByKind.get(kind)).filter(
    (r): r is NonNullable<typeof r> => Boolean(r)
  );

  return { rules, seedCountTiers, ageTiers };
});
