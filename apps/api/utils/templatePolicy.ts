/**
 * Pure decisions for presentation templates: how many a user may own,
 * who may see one, and who may publish one.
 *
 * These live outside the route handlers on purpose. Every one of them is
 * a rule an auditor will want to read in isolation — "can a stranger read
 * a private template" is a one-line question that should not require
 * reconstructing a Nitro handler in your head — and being side-effect
 * free they are the only part of the feature apps/api/test can cover
 * without a database.
 */

/** private — owner only. published — readable by everyone, copyable. */
export type TemplateVisibility = 'private' | 'published';

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

/**
 * Who may write to a template — and it depends on whether the site is
 * reading it.
 *
 * A private template is a draft: owner only, nobody else has any business
 * there. A PUBLISHED one is site-wide content, and two problems come with
 * treating it as ordinary property.
 *
 * The first is that a staffer who publishes and is later demoted keeps
 * editing what everyone sees. Gating publish/unpublish on a live role
 * check while leaving `content` ungated meant an ex-staffer could rewrite
 * the body of a template the whole site renders — the role check simply
 * never fired, because `visibility` was not the field being changed.
 *
 * The second is the mirror image: with write locked to the owner, a
 * published template nobody could reach was unremovable. No route, no
 * admin screen, no bypass — if the author went inactive the site was
 * stuck with it.
 *
 * So: writing to a published row requires a LIVE staff role, whether you
 * own it or not. That closes the demotion hole and hands the operator a
 * takedown path in the same rule. The cost is that a non-staff owner
 * cannot edit their own published template — correct, since they could
 * not have published it either, and a copy is one click away.
 */
export function canWriteTemplate(
  row: { ownerId: string; visibility: string },
  viewer: { id: string | null; isStaff: boolean },
): boolean {
  if (viewer.id === null) return false;
  if (row.visibility === 'published') return viewer.isStaff;
  return row.ownerId === viewer.id;
}

export type VisibilityDecision =
  | { ok: true; visibility: TemplateVisibility }
  | { ok: false; message: string };

/**
 * Resolve the visibility a write should land on.
 *
 * `requested` absent means "leave it alone", which is why `current` has
 * to be passed: a non-staff owner editing the name of a template a
 * staffer published (they can't — but the rule has to hold anyway) must
 * not silently unpublish it by omitting the field.
 *
 * Both directions are gated on staff, not just publishing. Unpublishing
 * is equally a change to what the whole site sees, and an ex-staffer
 * quietly retracting a template the community had come to rely on is the
 * same disruption as an unvetted one appearing.
 */
export function resolveTemplateVisibility(args: {
  requested?: TemplateVisibility;
  current: TemplateVisibility;
  isStaff: boolean;
}): VisibilityDecision {
  const { requested, current, isStaff } = args;
  if (requested === undefined || requested === current) {
    return { ok: true, visibility: current };
  }
  if (!isStaff) {
    return {
      ok: false,
      message:
        requested === 'published'
          ? 'Only staff can publish a template to the whole site'
          : 'Only staff can unpublish a template',
    };
  }
  return { ok: true, visibility: requested };
}
