/**
 * Pure decisions for presentation templates: how many a member may own, and
 * what they are told when they hit the ceiling.
 *
 * These live outside the route handlers on purpose. The quota is a rule an
 * auditor will want to read in isolation, and being side-effect free it is the
 * part of the feature apps/api/test can cover without a database.
 *
 * There is deliberately no visibility policy here any more. Members own
 * private templates and nothing else; the catalogue everybody sees is written
 * only by /api/admin/templates, which is gated by `requireAdminSession` and
 * has no per-row rule to express. The helpers that used to decide "may this
 * viewer write to a published row" (`canWriteTemplate`,
 * `resolveTemplateVisibility`) are gone rather than kept for symmetry: a
 * policy function nothing calls is worse than none, because it reads like
 * enforcement while the real enforcement drifts away from it.
 */

// The quota bounds. The default is deliberately low: a template is a
// stored-text surface, and an operator who wants generosity only has to
// move a number in the admin panel. The ceiling exists so a typo in the
// settings row (or a hand-edited Redis cache) cannot turn the per-user
// listing into an unbounded page.
export const TEMPLATE_QUOTA_DEFAULT = 5;
export const TEMPLATE_QUOTA_MIN = 1;
export const TEMPLATE_QUOTA_MAX = 100;

/**
 * Coerce whatever the settings row holds into a usable quota.
 *
 * Clamping in the *reader* rather than only in the writer is the house
 * convention (see getRequestMaxFillsPerUser): the settings table is a
 * key/value store of strings that operators do edit by hand, and a route
 * must never be able to read `NaN` or a negative cap — a negative cap
 * would lock every user out of creating anything, silently.
 *
 * Out-of-range values fall back to the default instead of being pinned to
 * the nearest bound: a stored `9999` is far more likely to be a mistake
 * than a deliberate request for the maximum.
 */
export function clampTemplateQuota(raw: unknown): number {
  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? parseInt(raw, 10)
        : NaN;
  if (!Number.isFinite(parsed)) return TEMPLATE_QUOTA_DEFAULT;
  const floored = Math.floor(parsed);
  if (floored < TEMPLATE_QUOTA_MIN || floored > TEMPLATE_QUOTA_MAX) {
    return TEMPLATE_QUOTA_DEFAULT;
  }
  return floored;
}

/**
 * The message the create endpoint refuses with. Extracted so the number
 * the user is told is provably the number that was enforced — the two
 * used to drift in the bounty board until the message was built from the
 * same variable as the comparison.
 */
export function templateQuotaMessage(quota: number): string {
  return `You have reached your limit of ${quota} template${
    quota === 1 ? '' : 's'
  } — delete one before creating another`;
}
