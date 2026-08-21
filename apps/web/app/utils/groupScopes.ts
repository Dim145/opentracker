/**
 * How a release is cut, and how that is said in the interface.
 *
 * The scope is the filter the flat listing never had. "Show me the season
 * packs" is a question about the SHAPE of a release, not about what it
 * contains, and no search term expresses it — a member after a whole season
 * has to open every result and read the filename to find out.
 *
 * Four values, mirroring `apps/api/utils/torrentGroups.ts`. Only a television
 * series can be cut three ways; everything else has the single scope `all`.
 */
export type GroupScope = 'episode' | 'season' | 'integral' | 'all';

export interface ScopeSummary {
  scope: GroupScope;
  /**
   * Units, not releases: "À l'épisode (7)" means seven episodes exist, however
   * many encodes each of them carries. The count a member is deciding on is
   * how much of the work is here, not how many files.
   */
  units: number;
  latest: string;
}

/** The i18n key that labels a scope chip. */
export function scopeLabelKey(scope: GroupScope): string {
  return `search.group.scope.${scope}`;
}
