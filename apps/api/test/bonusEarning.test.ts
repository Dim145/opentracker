import { describe, it, expect } from 'vitest';
import {
  BONUS_RULE_DEFAULTS,
  BONUS_RULE_KINDS,
  DEFAULT_AGE_TIERS,
  DEFAULT_SEED_COUNT_TIERS,
  resolveAgeMultiplier,
  resolveSeedCountMultiplier,
  validateBonusRuleConfig,
} from '../utils/bonusEarning';

// The earning economy. These multipliers are applied on every cron tick to
// every seed of every member: a tier mistake breaks nothing visible, it
// silently hands the wrong number of points to the whole community, and the
// ledger makes putting it right painful. Hence cases on the boundaries rather
// than in the middle of the ranges.

describe('resolveSeedCountMultiplier', () => {
  const tiers = DEFAULT_SEED_COUNT_TIERS; // sorted ascending by maxSeeders

  it('returns the first tier whose ceiling covers the count', () => {
    expect(resolveSeedCountMultiplier(0, tiers)).toBe(300);
    expect(resolveSeedCountMultiplier(1, tiers)).toBe(300);
    expect(resolveSeedCountMultiplier(2, tiers)).toBe(200);
    expect(resolveSeedCountMultiplier(5, tiers)).toBe(200);
    expect(resolveSeedCountMultiplier(6, tiers)).toBe(125);
    expect(resolveSeedCountMultiplier(20, tiers)).toBe(125);
    expect(resolveSeedCountMultiplier(21, tiers)).toBe(100);
  });

  it('is inclusive on each tier’s upper bound', () => {
    // The bound is the classic trap: `<=`, not `<`. A torrent with exactly 5
    // seeders must stay at 2×, not fall back to 1.25×.
    for (const t of tiers) {
      expect(resolveSeedCountMultiplier(t.maxSeeders, tiers)).toBe(t.multiplier);
    }
  });

  it('falls back to 1× rather than zero when no tier covers', () => {
    // The fallback protects against an operator emptying the table: better to
    // credit at the nominal rate than to cut the economy off in silence.
    expect(resolveSeedCountMultiplier(10, [])).toBe(100);
    expect(resolveSeedCountMultiplier(2_000_000, tiers)).toBe(100);
  });
});

describe('resolveAgeMultiplier', () => {
  // CAREFUL: this resolver expects tiers sorted DESCENDING by minAgeDays —
  // which is what `loadTiers()` produces (`orderBy desc`). The
  // `DEFAULT_AGE_TIERS` constant, on the other hand, is declared ascending
  // because it only seeds the table. Passing it straight through would always
  // return the first tier; this test pins both behaviours so a future caller
  // does not confuse the two arrays.
  const desc = [...DEFAULT_AGE_TIERS].sort((a, b) => b.minAgeDays - a.minAgeDays);

  it('returns the first tier whose floor is reached', () => {
    expect(resolveAgeMultiplier(0, desc)).toBe(100);
    expect(resolveAgeMultiplier(29, desc)).toBe(100);
    expect(resolveAgeMultiplier(30, desc)).toBe(120);
    expect(resolveAgeMultiplier(179, desc)).toBe(120);
    expect(resolveAgeMultiplier(180, desc)).toBe(150);
    expect(resolveAgeMultiplier(364, desc)).toBe(150);
    expect(resolveAgeMultiplier(365, desc)).toBe(200);
    expect(resolveAgeMultiplier(10_000, desc)).toBe(200);
  });

  it('is inclusive on each tier’s lower bound', () => {
    for (const t of desc) {
      expect(resolveAgeMultiplier(t.minAgeDays, desc)).toBe(t.multiplier);
    }
  });

  it('returns 1× on an empty array', () => {
    expect(resolveAgeMultiplier(500, [])).toBe(100);
  });

  it('documents the trap: an ascending array pins everything to the first tier', () => {
    // Not desirable behaviour, but a fact worth knowing. If this test ever
    // fails because the resolver started sorting for itself, so much the
    // better — replace it with the opposite assertion then.
    expect(resolveAgeMultiplier(10_000, DEFAULT_AGE_TIERS)).toBe(100);
  });
});

describe('validateBonusRuleConfig', () => {
  it('accepts the shipped defaults for every rule kind', () => {
    // If a default failed to validate against its own schema, the first-boot
    // seeding would fail — and only on first boot, which means at the
    // operator's site and never at ours.
    for (const kind of BONUS_RULE_KINDS) {
      expect(() =>
        validateBonusRuleConfig(kind, BONUS_RULE_DEFAULTS[kind]),
      ).not.toThrow();
    }
  });

  it('refuses a negative or outsized seeding rate', () => {
    expect(() =>
      validateBonusRuleConfig('seeding', { pointsPerHourPerSeed: -1 }),
    ).toThrow();
    expect(() =>
      validateBonusRuleConfig('seeding', { pointsPerHourPerSeed: 1001 }),
    ).toThrow();
    expect(() =>
      validateBonusRuleConfig('seeding', { pointsPerHourPerSeed: 0 }),
    ).not.toThrow();
  });

  it('refuses an unknown key instead of ignoring it', () => {
    // The schemas are `.strict()`: a typo in the admin config must surface,
    // not be silently dropped.
    expect(() =>
      validateBonusRuleConfig('seeding', {
        pointsPerHourPerSeed: 1,
        pointsPerHour: 5,
      }),
    ).toThrow();
  });

  it('refuses an empty or wrongly typed config', () => {
    expect(() => validateBonusRuleConfig('seeding', {})).toThrow();
    expect(() => validateBonusRuleConfig('seeding', null)).toThrow();
    expect(() => validateBonusRuleConfig('daily_login', 'five')).toThrow();
  });
});
