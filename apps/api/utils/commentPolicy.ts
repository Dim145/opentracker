/**
 * Who may comment on a member's uploads.
 *
 * Lives apart from the route so the rule is one testable function rather than
 * a condition buried in a handler, and so the threshold has exactly one
 * definition — a number that disagrees with the sentence shown in the settings
 * page is worse than no restriction at all.
 */

/**
 * Minimum account age, in days, that `users.restrict_comments` demands.
 *
 * Thirty days rather than a calendar month: the settings copy says "at least
 * 1 month", and a fixed window is the reading that cannot surprise anyone —
 * a calendar month would make the same account eligible on the 28th in
 * February and the 31st in March.
 */
export const COMMENT_MIN_ACCOUNT_AGE_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CommentEligibility {
  allowed: boolean;
  /** Whole days still to wait. Zero when allowed. */
  daysRemaining: number;
}

/**
 * Decide whether `author` may comment on a torrent uploaded by `uploader`.
 *
 * Three ways past the restriction, and all three are deliberate:
 *
 *   - it is off for that uploader, which is the default;
 *   - the commenter is staff, because a moderator has to be able to answer a
 *     thread on any release, including on a brand-new staff account;
 *   - the commenter is the uploader, since a restriction meant to keep
 *     throwaway accounts out should never lock someone out of their own
 *     release.
 *
 * `now` is a parameter rather than a `Date.now()` call so the boundary is
 * testable without freezing the clock.
 */
export function canComment(opts: {
  uploader: { id: string; restrictComments: boolean } | null;
  author: { id: string; createdAt: Date; isAdmin: boolean; isModerator: boolean };
  now?: Date;
}): CommentEligibility {
  const { uploader, author } = opts;

  // An orphaned release — the uploader's account is gone — has nobody left to
  // shield, so it falls back to the open default.
  if (!uploader?.restrictComments) return { allowed: true, daysRemaining: 0 };
  if (author.isAdmin || author.isModerator) return { allowed: true, daysRemaining: 0 };
  if (author.id === uploader.id) return { allowed: true, daysRemaining: 0 };

  const now = opts.now ?? new Date();
  const ageDays = (now.getTime() - author.createdAt.getTime()) / DAY_MS;
  if (ageDays >= COMMENT_MIN_ACCOUNT_AGE_DAYS) {
    return { allowed: true, daysRemaining: 0 };
  }

  // Round up: with 29.2 days elapsed the honest answer is "1 more day", not
  // "0 days" on an account that still cannot post.
  return {
    allowed: false,
    daysRemaining: Math.max(1, Math.ceil(COMMENT_MIN_ACCOUNT_AGE_DAYS - ageDays)),
  };
}
