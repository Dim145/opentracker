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

// Économie de gain. Ces multiplicateurs sont appliqués à chaque tick du cron
// sur chaque seed de chaque membre : une erreur de palier ne casse rien de
// visible, elle distribue silencieusement le mauvais nombre de points à toute
// la communauté, et le ledger rend le rattrapage pénible. D'où des cas aux
// bornes plutôt qu'au milieu des intervalles.

describe('resolveSeedCountMultiplier', () => {
  const tiers = DEFAULT_SEED_COUNT_TIERS; // trié croissant par maxSeeders

  it('rend le premier palier dont le plafond couvre le compte', () => {
    expect(resolveSeedCountMultiplier(0, tiers)).toBe(300);
    expect(resolveSeedCountMultiplier(1, tiers)).toBe(300);
    expect(resolveSeedCountMultiplier(2, tiers)).toBe(200);
    expect(resolveSeedCountMultiplier(5, tiers)).toBe(200);
    expect(resolveSeedCountMultiplier(6, tiers)).toBe(125);
    expect(resolveSeedCountMultiplier(20, tiers)).toBe(125);
    expect(resolveSeedCountMultiplier(21, tiers)).toBe(100);
  });

  it('est inclusif sur la borne haute de chaque palier', () => {
    // La borne est le piège classique : `<=` et non `<`. Un torrent avec
    // exactement 5 seeders doit rester à 2×, pas retomber à 1,25×.
    for (const t of tiers) {
      expect(resolveSeedCountMultiplier(t.maxSeeders, tiers)).toBe(t.multiplier);
    }
  });

  it('retombe sur 1× plutôt que sur zéro quand aucun palier ne couvre', () => {
    // Le repli protège d'un opérateur qui vide la table : mieux vaut
    // créditer au taux nominal que de couper l'économie en silence.
    expect(resolveSeedCountMultiplier(10, [])).toBe(100);
    expect(resolveSeedCountMultiplier(2_000_000, tiers)).toBe(100);
  });
});

describe('resolveAgeMultiplier', () => {
  // ATTENTION : ce résolveur attend les paliers triés DÉCROISSANT par
  // minAgeDays — c'est ce que produit `loadTiers()` (`orderBy desc`). La
  // constante `DEFAULT_AGE_TIERS` est, elle, déclarée croissante parce
  // qu'elle ne sert qu'à amorcer la table. Les passer directement rendrait
  // toujours le premier palier ; ce test fige les deux comportements pour
  // qu'un futur appelant ne confonde pas les deux tableaux.
  const desc = [...DEFAULT_AGE_TIERS].sort((a, b) => b.minAgeDays - a.minAgeDays);

  it('rend le premier palier dont le plancher est atteint', () => {
    expect(resolveAgeMultiplier(0, desc)).toBe(100);
    expect(resolveAgeMultiplier(29, desc)).toBe(100);
    expect(resolveAgeMultiplier(30, desc)).toBe(120);
    expect(resolveAgeMultiplier(179, desc)).toBe(120);
    expect(resolveAgeMultiplier(180, desc)).toBe(150);
    expect(resolveAgeMultiplier(364, desc)).toBe(150);
    expect(resolveAgeMultiplier(365, desc)).toBe(200);
    expect(resolveAgeMultiplier(10_000, desc)).toBe(200);
  });

  it('est inclusif sur la borne basse de chaque palier', () => {
    for (const t of desc) {
      expect(resolveAgeMultiplier(t.minAgeDays, desc)).toBe(t.multiplier);
    }
  });

  it('rend 1× sur un tableau vide', () => {
    expect(resolveAgeMultiplier(500, [])).toBe(100);
  });

  it('documente le piège : un tableau croissant colle tout au premier palier', () => {
    // Non pas un comportement souhaitable, mais un fait à connaître. Si un
    // jour ce test tombe parce que le résolveur trie lui-même, tant mieux —
    // il faudra alors le remplacer par l'assertion inverse.
    expect(resolveAgeMultiplier(10_000, DEFAULT_AGE_TIERS)).toBe(100);
  });
});

describe('validateBonusRuleConfig', () => {
  it('accepte les défauts livrés pour chaque type de règle', () => {
    // Si un défaut ne validait pas contre son propre schéma, l'amorce au
    // premier démarrage échouerait — et seulement au premier démarrage,
    // c'est-à-dire chez l'opérateur et jamais chez nous.
    for (const kind of BONUS_RULE_KINDS) {
      expect(() =>
        validateBonusRuleConfig(kind, BONUS_RULE_DEFAULTS[kind]),
      ).not.toThrow();
    }
  });

  it('refuse un taux de seeding négatif ou démesuré', () => {
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

  it('refuse une clé inconnue au lieu de l’ignorer', () => {
    // Les schémas sont `.strict()` : une faute de frappe dans la config
    // d'administration doit remonter, pas être silencieusement perdue.
    expect(() =>
      validateBonusRuleConfig('seeding', {
        pointsPerHourPerSeed: 1,
        pointsPerHour: 5,
      }),
    ).toThrow();
  });

  it('refuse une config vide ou du mauvais type', () => {
    expect(() => validateBonusRuleConfig('seeding', {})).toThrow();
    expect(() => validateBonusRuleConfig('seeding', null)).toThrow();
    expect(() => validateBonusRuleConfig('daily_login', 'cinq')).toThrow();
  });
});
