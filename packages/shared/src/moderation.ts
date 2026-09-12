/**
 * Les motifs de modération, typés.
 *
 * Avant, rejeter un envoi demandait un `message` libre de 1 à 4000 caractères
 * et rien d'autre. Un modérateur retapait la même phrase des dizaines de fois
 * par semaine, deux modérateurs formulaient le même refus différemment, et
 * personne ne pouvait compter POURQUOI les envois étaient refusés — donc
 * personne ne savait quelle règle méritait d'être mieux expliquée en amont.
 *
 * Les codes vivent ICI plutôt que dans une table parce qu'ils doivent être
 * traduits : une ligne de base de données n'a pas de locale. Le code est ce
 * qu'on enregistre et ce qu'on compte ; le texte envoyé au membre reste
 * modifiable avant l'envoi, et le message libre reste obligatoire.
 *
 * Personnaliser les libellés par instance viendra quand un opérateur le
 * demandera — la traduction, elle, est un besoin immédiat.
 */

/** Ce sur quoi un motif peut porter. Un code n'est proposé que dans sa portée. */
export type ModerationScope = 'reject' | 'changes' | 'warning';

export interface ModerationReason {
  code: string;
  /** Les portées où ce motif a un sens. Un doublon ne « demande pas de
   *  modification » : il n'y a rien à corriger. */
  scopes: readonly ModerationScope[];
  /** Suffixe de clé i18n, sous `moderation.reasons.<code>`. */
  i18n: string;
}

/**
 * Dix motifs, tirés de ce qui fait réellement refuser un envoi sur un tracker.
 * L'ordre est celui d'affichage : les plus fréquents d'abord, `other` en
 * dernier parce qu'il est la porte de sortie et non un choix par défaut.
 */
export const MODERATION_REASONS: readonly ModerationReason[] = [
  { code: 'duplicate', scopes: ['reject'], i18n: 'duplicate' },
  { code: 'naming', scopes: ['changes', 'reject'], i18n: 'naming' },
  { code: 'missing_nfo', scopes: ['changes'], i18n: 'missingNfo' },
  { code: 'thin_description', scopes: ['changes'], i18n: 'thinDescription' },
  { code: 'wrong_category', scopes: ['changes', 'reject'], i18n: 'wrongCategory' },
  { code: 'wrong_metadata', scopes: ['changes', 'reject'], i18n: 'wrongMetadata' },
  { code: 'quality_mismatch', scopes: ['changes', 'reject'], i18n: 'qualityMismatch' },
  { code: 'bad_source', scopes: ['reject', 'warning'], i18n: 'badSource' },
  { code: 'rules_breach', scopes: ['reject', 'warning'], i18n: 'rulesBreach' },
  { code: 'other', scopes: ['reject', 'changes', 'warning'], i18n: 'other' },
] as const;

const BY_CODE = new Map(MODERATION_REASONS.map((r) => [r.code, r]));

/** Les codes valides pour une portée, dans l'ordre d'affichage. */
export function reasonsForScope(scope: ModerationScope): ModerationReason[] {
  return MODERATION_REASONS.filter((r) => r.scopes.includes(scope));
}

/** Un code inconnu, ou hors de sa portée, n'est pas acceptable. */
export function isValidReasonCode(
  code: string,
  scope: ModerationScope
): boolean {
  return BY_CODE.get(code)?.scopes.includes(scope) ?? false;
}

/** Tous les codes, pour un `z.enum`. Figé au chargement. */
export const MODERATION_REASON_CODES = MODERATION_REASONS.map(
  (r) => r.code
) as readonly string[];

// ─────────────────────────────────────────────────────────────────────────────
// Motifs de signalement, côté membre
// ─────────────────────────────────────────────────────────────────────────────
//
// `reports.reason` était du texte libre de 10 à 500 caractères, pour la même
// raison et avec le même effet : impossible de regrouper, donc impossible de
// voir qu'un même problème revient. Le texte reste — c'est là que le signalant
// raconte — mais il est désormais rangé sous une catégorie.

export type ReportTargetType = 'torrent' | 'user' | 'post' | 'comment';

export interface ReportCategory {
  code: string;
  /** Les cibles où cette catégorie est proposée. */
  targets: readonly ReportTargetType[];
  i18n: string;
}

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  { code: 'dead_torrent', targets: ['torrent'], i18n: 'deadTorrent' },
  { code: 'duplicate', targets: ['torrent'], i18n: 'duplicate' },
  { code: 'mislabelled', targets: ['torrent'], i18n: 'mislabelled' },
  { code: 'bad_metadata', targets: ['torrent'], i18n: 'badMetadata' },
  { code: 'malware', targets: ['torrent'], i18n: 'malware' },
  { code: 'spam', targets: ['user', 'post', 'comment'], i18n: 'spam' },
  { code: 'harassment', targets: ['user', 'post', 'comment'], i18n: 'harassment' },
  { code: 'cheating', targets: ['user'], i18n: 'cheating' },
  {
    code: 'other',
    targets: ['torrent', 'user', 'post', 'comment'],
    i18n: 'other',
  },
] as const;

export function reportCategoriesFor(target: ReportTargetType): ReportCategory[] {
  return REPORT_CATEGORIES.filter((c) => c.targets.includes(target));
}

export const REPORT_CATEGORY_CODES = REPORT_CATEGORIES.map(
  (c) => c.code
) as readonly string[];
