/**
 * Bonus-earning rules + tiered multiplier resolver.
 *
 * Five rule kinds credit `users.bonus_points`:
 *
 *   - `seeding`              base × seed-count tier × age tier per cron tick
 *   - `first_seeder`         one-time when the user is the unique seeder
 *   - `seeding_milestone`    cumulative-seed-time thresholds per (user, torrent)
 *   - `daily_login`          once per UTC day on first auth-status poll
 *   - `account_age_monthly`  monthly loyalty bonus
 *
 * Each kind owns a Zod schema for its `config` jsonb so a malformed
 * row disables the rule rather than letting bad data through to the
 * crediting path. Applicator helpers below are pure-ish (they read
 * the DB but only mutate `users.bonus_points` + `bonus_grants`); the
 * cron and the auth-status hook compose them.
 *
 * Multipliers in tier rows and any other config follow the
 * `bonus_events` convention: basis points × 100 (100 = 1×, 200 = 2×).
 *
 * Idempotency:
 *   - `first_seeder`, `seeding_milestone` and `account_age_monthly`
 *     check `bonus_grants` before crediting — never double-pays the
 *     same trigger.
 *   - `seeding` is non-idempotent by design (it pays per cron tick),
 *     but every credit gets a `bonus_grants` row so the audit trail
 *     stays complete.
 *   - `daily_login` is gated by a Redis SETNX on a date-keyed
 *     namespace (see `creditDailyLoginIfDue`).
 */
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { redis } from './server';

// ---------------------------------------------------------------------------
// Rule kinds + per-kind config schemas
// ---------------------------------------------------------------------------

export const BONUS_RULE_KINDS = [
  'seeding',
  'first_seeder',
  'seeding_milestone',
  'daily_login',
  'account_age_monthly',
] as const;
export type BonusRuleKind = (typeof BONUS_RULE_KINDS)[number];

const seedingConfig = z
  .object({
    /** Whole points credited per active seed per cron tick before
     * tier multipliers are applied. The cron normalises to a
     * "per-hour" target by dividing by INTERVAL_HOURS at apply time. */
    pointsPerHourPerSeed: z.number().nonnegative().max(1000),
  })
  .strict();

const firstSeederConfig = z
  .object({
    /** One-time credit when a user is observed as the only seeder of
     * a torrent. Capped to keep an admin typo from gifting whole
     * shop balances. */
    reward: z.number().int().nonnegative().max(100_000),
  })
  .strict();

const seedingMilestoneConfig = z
  .object({
    /** Cumulative seed-time milestones (per user × torrent), driven
     * by the `hnr_tracking.seed_time` column the tracker already
     * maintains. Each entry triggers exactly once per (user, torrent)
     * pair — the grants ledger gates re-credits. */
    thresholds: z
      .array(
        z
          .object({
            hours: z.number().int().positive().max(24 * 365 * 5),
            reward: z.number().int().nonnegative().max(100_000),
          })
          .strict()
      )
      .max(20),
  })
  .strict();

const dailyLoginConfig = z
  .object({
    /** Credit on first auth-status poll of each UTC day. */
    reward: z.number().int().nonnegative().max(10_000),
  })
  .strict();

const accountAgeMonthlyConfig = z
  .object({
    /** Credit every 30 days based on last `account_age_monthly` grant.
     * New users wait a full 30 days before their first credit. */
    rewardPerMonth: z.number().int().nonnegative().max(50_000),
  })
  .strict();

export const bonusRuleConfigSchemas: Record<BonusRuleKind, z.ZodTypeAny> = {
  seeding: seedingConfig,
  first_seeder: firstSeederConfig,
  seeding_milestone: seedingMilestoneConfig,
  daily_login: dailyLoginConfig,
  account_age_monthly: accountAgeMonthlyConfig,
};

export function validateBonusRuleConfig(
  kind: BonusRuleKind,
  config: unknown
): unknown {
  return bonusRuleConfigSchemas[kind].parse(config);
}

/**
 * Default config seeded on first boot. Operators can edit any of these
 * from `/admin/bonus-rules` — the seed only runs when no row exists
 * for a given kind, so user changes are never overwritten.
 */
export const BONUS_RULE_DEFAULTS: Record<BonusRuleKind, unknown> = {
  seeding: { pointsPerHourPerSeed: 1 },
  first_seeder: { reward: 25 },
  seeding_milestone: {
    thresholds: [
      { hours: 24, reward: 25 },
      { hours: 24 * 7, reward: 100 },
      { hours: 24 * 30, reward: 500 },
    ],
  },
  daily_login: { reward: 5 },
  account_age_monthly: { rewardPerMonth: 50 },
};

/**
 * Default tier curves. Same logic as the rules: seeded only when the
 * relevant table is completely empty, never overwriting user edits.
 */
export const DEFAULT_SEED_COUNT_TIERS: Array<{
  maxSeeders: number;
  multiplier: number;
}> = [
  // ≤ 1 seeder (the user is alone): 3×
  { maxSeeders: 1, multiplier: 300 },
  // 2-5 seeders: 2×
  { maxSeeders: 5, multiplier: 200 },
  // 6-20 seeders: 1.25×
  { maxSeeders: 20, multiplier: 125 },
  // 21+ seeders: 1×
  { maxSeeders: 1_000_000, multiplier: 100 },
];

export const DEFAULT_AGE_TIERS: Array<{
  minAgeDays: number;
  multiplier: number;
}> = [
  // < 30 days: 1×
  { minAgeDays: 0, multiplier: 100 },
  // ≥ 30 days: 1.2×
  { minAgeDays: 30, multiplier: 120 },
  // ≥ 6 months: 1.5×
  { minAgeDays: 180, multiplier: 150 },
  // ≥ 1 year: 2×
  { minAgeDays: 365, multiplier: 200 },
];

// ---------------------------------------------------------------------------
// Tier resolvers — pure functions over the cached tier arrays
// ---------------------------------------------------------------------------

export interface ResolvedTiers {
  seedCountTiers: Array<{ maxSeeders: number; multiplier: number }>;
  ageTiers: Array<{ minAgeDays: number; multiplier: number }>;
}

/**
 * Pulls every enabled tier row out of the DB, sorted in the
 * evaluation order (seed-count ascending, age descending). Cron
 * callers cache the result for a single tick.
 */
export async function loadTiers(): Promise<ResolvedTiers> {
  const seedCountTiers = await db
    .select({
      maxSeeders: schema.bonusSeedCountTiers.maxSeeders,
      multiplier: schema.bonusSeedCountTiers.multiplier,
    })
    .from(schema.bonusSeedCountTiers)
    .where(eq(schema.bonusSeedCountTiers.enabled, true))
    .orderBy(asc(schema.bonusSeedCountTiers.maxSeeders));

  const ageTiers = await db
    .select({
      minAgeDays: schema.bonusAgeTiers.minAgeDays,
      multiplier: schema.bonusAgeTiers.multiplier,
    })
    .from(schema.bonusAgeTiers)
    .where(eq(schema.bonusAgeTiers.enabled, true))
    .orderBy(desc(schema.bonusAgeTiers.minAgeDays));

  return { seedCountTiers, ageTiers };
}

/**
 * Resolves the multiplier for a given seeder count. Walks the
 * sorted-ascending tier array and returns the first row whose
 * `maxSeeders` is ≥ the count. Falls back to 100 (1×) when no tier
 * matches — keeps the cron from accidentally zeroing out credits if
 * the operator deletes every row.
 */
export function resolveSeedCountMultiplier(
  seederCount: number,
  tiers: ResolvedTiers['seedCountTiers']
): number {
  for (const t of tiers) {
    if (seederCount <= t.maxSeeders) return t.multiplier;
  }
  return 100;
}

/**
 * Resolves the multiplier for a torrent's age in days. Walks the
 * sorted-descending tier array and returns the first row whose
 * `minAgeDays` ≤ the age. Same 1× fallback rationale as above.
 */
export function resolveAgeMultiplier(
  ageDays: number,
  tiers: ResolvedTiers['ageTiers']
): number {
  for (const t of tiers) {
    if (ageDays >= t.minAgeDays) return t.multiplier;
  }
  return 100;
}

// ---------------------------------------------------------------------------
// Per-kind applicators
// ---------------------------------------------------------------------------

/** Common args for every applicator: rule already validated + enabled. */
interface ApplicatorContext {
  ruleConfig: unknown;
}

/**
 * Atomic credit + grant-row insertion. Wraps both writes in a single
 * transaction so a partial failure doesn't leave the ledger out of
 * sync with the balance.
 */
export async function creditPoints(args: {
  userId: string;
  source: BonusRuleKind;
  amount: number;
  torrentId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (args.amount <= 0) return;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`UPDATE ${schema.users}
          SET bonus_points = bonus_points + ${args.amount}
          WHERE id = ${args.userId}`
    );
    await tx.insert(schema.bonusGrants).values({
      id: uuidv4(),
      userId: args.userId,
      source: args.source,
      torrentId: args.torrentId ?? null,
      amount: args.amount,
      metadata: args.metadata ?? null,
    });
  });

  // Surface the two high-signal one-off grants as notifications.
  // `seeding`, `account_age_monthly`, `daily_login` are intentionally
  // skipped — they're recurring background credits and would flood
  // the bell. Lazy import avoids cycling notify.ts → settings.ts →
  // bonusEarning.ts at module-graph load time.
  if (args.source === 'first_seeder' || args.source === 'seeding_milestone') {
    try {
      const { notify } = await import('./notify');
      void notify(
        args.userId,
        args.source === 'first_seeder'
          ? 'first_seeder_reward'
          : 'seeding_milestone_reached',
        {
          amount: args.amount,
          torrentId: args.torrentId ?? null,
          ...(args.metadata ?? {}),
        },
        args.torrentId ? null : '/me',
      );
    } catch (err) {
      console.warn('[BonusEarning] notify failed:', (err as Error).message);
    }
  }
}

/**
 * `seeding` rule applicator. Credits each (userId, torrentId) seeder
 * pair once per call (one cron tick), with `pointsPerHourPerSeed ×
 * seedCountMul × ageMul × intervalFraction`.
 *
 * `intervalHours` is the cron tick duration in hours so the rate stays
 * "per hour" regardless of how often the operator chose to schedule
 * the cron.
 */
export async function applySeedingRule(args: {
  config: z.infer<typeof seedingConfig>;
  intervalHours: number;
  /** (userId, torrentId) pairs currently seeding, with the live seed
   *  count for that torrent (before the cron tick) and the torrent's
   *  age in days. */
  seederTorrentRows: Array<{
    userId: string;
    torrentId: string;
    seedersForTorrent: number;
    ageDays: number;
  }>;
  tiers: ResolvedTiers;
}): Promise<{ usersCredited: number; pointsAwarded: number }> {
  const { config, intervalHours, seederTorrentRows, tiers } = args;
  if (config.pointsPerHourPerSeed <= 0) {
    return { usersCredited: 0, pointsAwarded: 0 };
  }
  // Cap per (user, torrent) per cron tick. Anything bigger means the
  // operator's curve is wrong — refuse to compound the mistake.
  const PER_TICK_PER_PAIR_CAP = 10_000;

  // Group per-pair points by user so each tick produces ONE grant
  // row per seeder — not one per (user, torrent) pair. A user
  // seeding 17 torrents otherwise floods their ledger with 17
  // identical-timestamp rows every tick; the user-facing /me
  // history page would become unreadable. The summary metadata
  // keeps the torrent count so the UI can render the line as
  // "seed cadence for N torrents".
  const perUser = new Map<
    string,
    { total: number; torrentCount: number; pairs: number }
  >();
  for (const row of seederTorrentRows) {
    const seedMul = resolveSeedCountMultiplier(
      row.seedersForTorrent,
      tiers.seedCountTiers
    );
    const ageMul = resolveAgeMultiplier(row.ageDays, tiers.ageTiers);
    // bp × 100, multiply both ⇒ × 10_000 — divide once at the end.
    const raw =
      config.pointsPerHourPerSeed *
      intervalHours *
      seedMul *
      ageMul;
    const points = Math.min(
      Math.round(raw / 10_000),
      PER_TICK_PER_PAIR_CAP
    );
    if (points <= 0) continue;
    const bucket = perUser.get(row.userId) ?? {
      total: 0,
      torrentCount: 0,
      pairs: 0,
    };
    bucket.total += points;
    bucket.torrentCount += 1;
    bucket.pairs += 1;
    perUser.set(row.userId, bucket);
  }

  let totalAwarded = 0;
  for (const [userId, bucket] of perUser) {
    if (bucket.total <= 0) continue;
    await creditPoints({
      userId,
      source: 'seeding',
      torrentId: null,
      amount: bucket.total,
      metadata: {
        torrentCount: bucket.torrentCount,
      },
    });
    totalAwarded += bucket.total;
  }
  return { usersCredited: perUser.size, pointsAwarded: totalAwarded };
}

/**
 * `first_seeder` applicator. For each (userId, torrentId) row whose
 * torrent currently has exactly one seeder (and that one is `userId`),
 * credit the one-time reward — but only if the grants ledger doesn't
 * already record ANY credit for this torrent (regardless of user).
 *
 * The gate is per-torrent on purpose: scenarios where the bug used
 * to bite were "Alice is the only seeder at tick T → credited; Alice
 * leaves; Bob shows up alone at tick T+1 → credited again". The
 * previous gate keyed on `(user, torrent)` so each subsequent
 * "lonely seeder" earned the prize too. A first-seeder reward is by
 * definition one-per-torrent — once it's been paid out we lock the
 * row even if the seeder set churns later.
 */
export async function applyFirstSeederRule(args: {
  config: z.infer<typeof firstSeederConfig>;
  /** Same input as the seeding rule, filtered to seedersForTorrent === 1. */
  uniqueSeederPairs: Array<{ userId: string; torrentId: string }>;
}): Promise<{ usersCredited: number; pointsAwarded: number }> {
  const { config, uniqueSeederPairs } = args;
  if (config.reward <= 0 || uniqueSeederPairs.length === 0) {
    return { usersCredited: 0, pointsAwarded: 0 };
  }
  let credited = 0;
  let awarded = 0;
  const lockedTorrents = new Set<string>();
  for (const pair of uniqueSeederPairs) {
    if (lockedTorrents.has(pair.torrentId)) continue;
    const [existing] = await db
      .select({ id: schema.bonusGrants.id })
      .from(schema.bonusGrants)
      .where(
        and(
          eq(schema.bonusGrants.source, 'first_seeder'),
          eq(schema.bonusGrants.torrentId, pair.torrentId)
        )
      )
      .limit(1);
    if (existing) {
      lockedTorrents.add(pair.torrentId);
      continue;
    }
    await creditPoints({
      userId: pair.userId,
      source: 'first_seeder',
      torrentId: pair.torrentId,
      amount: config.reward,
    });
    // Lock the torrent in this tick too so the loop doesn't re-pay
    // when the SCAN happens to surface multiple users in the same
    // torrent's "unique" window across two scan rounds. The cross-
    // replica SETNX lock in bonus-collector already prevents two
    // ticks from racing each other.
    lockedTorrents.add(pair.torrentId);
    credited++;
    awarded += config.reward;
  }
  return { usersCredited: credited, pointsAwarded: awarded };
}

/**
 * `seeding_milestone` applicator. Reads `hnr_tracking.seed_time` for
 * every (user, torrent) pair that crossed at least one threshold
 * since its last grant, and credits each freshly-crossed milestone.
 *
 * The grants ledger gates re-credits: a milestone of N hours emits a
 * row with `metadata.thresholdHours = N`, so we look it up by source
 * + user + torrent + that metadata before paying.
 */
export async function applyMilestoneRule(args: {
  config: z.infer<typeof seedingMilestoneConfig>;
}): Promise<{ usersCredited: number; pointsAwarded: number }> {
  const { config } = args;
  if (config.thresholds.length === 0) {
    return { usersCredited: 0, pointsAwarded: 0 };
  }
  // Walk every active hnr_tracking row whose seed_time crosses at
  // least the smallest threshold. This keeps us from scanning idle
  // rows that haven't moved.
  const minSeconds = Math.min(...config.thresholds.map((t) => t.hours)) * 3600;
  const candidates = await db
    .select({
      userId: schema.hnrTracking.userId,
      torrentId: schema.hnrTracking.torrentId,
      seedTime: schema.hnrTracking.seedTime,
    })
    .from(schema.hnrTracking)
    .where(gte(schema.hnrTracking.seedTime, minSeconds));

  let credited = 0;
  let awarded = 0;
  for (const row of candidates) {
    const seedHours = row.seedTime / 3600;
    for (const threshold of config.thresholds) {
      if (seedHours < threshold.hours) continue;
      const [already] = await db
        .select({ id: schema.bonusGrants.id })
        .from(schema.bonusGrants)
        .where(
          and(
            eq(schema.bonusGrants.source, 'seeding_milestone'),
            eq(schema.bonusGrants.userId, row.userId),
            eq(schema.bonusGrants.torrentId, row.torrentId),
            sql`${schema.bonusGrants.metadata}->>'thresholdHours' = ${String(
              threshold.hours
            )}`
          )
        )
        .limit(1);
      if (already) continue;
      await creditPoints({
        userId: row.userId,
        source: 'seeding_milestone',
        torrentId: row.torrentId,
        amount: threshold.reward,
        metadata: { thresholdHours: threshold.hours, seedHours },
      });
      credited++;
      awarded += threshold.reward;
    }
  }
  return { usersCredited: credited, pointsAwarded: awarded };
}

/**
 * `daily_login` — gated by a Redis SETNX on `bonus:dailyLogin:{userId}:{YYYYMMDD}`
 * with a 36 h expiry. The first auth-status hit of the day for a user
 * lands the credit; later hits no-op.
 *
 * Called from `routes/api/auth/status.get.ts` so it fires on every
 * authenticated visit without needing a separate cron.
 */
export async function creditDailyLoginIfDue(userId: string): Promise<number> {
  const [rule] = await db
    .select({ enabled: schema.bonusRules.enabled, config: schema.bonusRules.config })
    .from(schema.bonusRules)
    .where(eq(schema.bonusRules.kind, 'daily_login'))
    .limit(1);
  if (!rule || !rule.enabled) return 0;
  const parsed = dailyLoginConfig.safeParse(rule.config);
  if (!parsed.success || parsed.data.reward <= 0) return 0;

  const today = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const key = `bonus:dailyLogin:${userId}:${today}`;
  // SET NX with a 36 h TTL — slightly more than 24 h so a user near
  // midnight UTC doesn't double-claim from a clock skew.
  const claimed = await redis.set(key, '1', 'EX', 36 * 3600, 'NX');
  if (claimed !== 'OK') return 0;

  await creditPoints({
    userId,
    source: 'daily_login',
    amount: parsed.data.reward,
  });
  return parsed.data.reward;
}

/**
 * `account_age_monthly` — for every user whose last grant of this
 * source is older than 30 days (or who has never received one),
 * credit the monthly reward.
 *
 * The cron runs hourly but the per-user check is gated on the grants
 * ledger so the actual credit fires at most once every ~30 days.
 */
export async function applyAccountAgeMonthlyRule(args: {
  config: z.infer<typeof accountAgeMonthlyConfig>;
}): Promise<{ usersCredited: number; pointsAwarded: number }> {
  const { config } = args;
  if (config.rewardPerMonth <= 0) {
    return { usersCredited: 0, pointsAwarded: 0 };
  }
  // 30-day window. Users created less than 30 d ago are skipped — the
  // first credit fires on the first cron tick after their 30 d
  // anniversary.
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  // Pull every non-banned user older than the cutoff.
  const users = await db
    .select({ id: schema.users.id, createdAt: schema.users.createdAt })
    .from(schema.users)
    .where(
      and(
        lt(schema.users.createdAt, cutoff),
        eq(schema.users.isBanned, false)
      )
    );

  let credited = 0;
  let awarded = 0;
  for (const u of users) {
    const [latest] = await db
      .select({ createdAt: schema.bonusGrants.createdAt })
      .from(schema.bonusGrants)
      .where(
        and(
          eq(schema.bonusGrants.source, 'account_age_monthly'),
          eq(schema.bonusGrants.userId, u.id)
        )
      )
      .orderBy(desc(schema.bonusGrants.createdAt))
      .limit(1);
    if (latest && latest.createdAt > cutoff) continue;
    await creditPoints({
      userId: u.id,
      source: 'account_age_monthly',
      amount: config.rewardPerMonth,
    });
    credited++;
    awarded += config.rewardPerMonth;
  }
  return { usersCredited: credited, pointsAwarded: awarded };
}

/** Returns the rule row for a kind, or null when none configured. */
export async function loadRule(kind: BonusRuleKind): Promise<{
  enabled: boolean;
  config: unknown;
} | null> {
  const [row] = await db
    .select({ enabled: schema.bonusRules.enabled, config: schema.bonusRules.config })
    .from(schema.bonusRules)
    .where(eq(schema.bonusRules.kind, kind))
    .limit(1);
  return row ? { enabled: row.enabled, config: row.config } : null;
}
