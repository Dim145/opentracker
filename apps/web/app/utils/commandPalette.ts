import { foldForSearch } from './navFilter';

export type PaletteGroup = 'navigation' | 'actions' | 'torrents' | 'users';

export interface PaletteItem {
  id: string;
  group: PaletteGroup;
  label: string;
  icon: string;
  to: string;
  /** Shown dimmed after the label — a category, a role, a section name. */
  meta?: string;
  /**
   * Extra words to match on that are never displayed. Lets "ban" reach Banned
   * IPs and "logout" reach the sign-out action without putting either word in
   * the label.
   */
  keywords?: string;
  /**
   * For the handful of entries that do something instead of going somewhere —
   * switching the theme, signing out. `to` stays the fallback so every item
   * has a destination the keyboard and a middle-click can both use.
   */
  run?: () => void | Promise<void>;
}

/**
 * How well `haystack` answers `needle`. Zero means no match at all.
 *
 * Four tiers, and the gaps between them are what make the ordering feel right
 * rather than merely defensible: an exact hit must outrank a prefix, a prefix
 * must outrank a word buried mid-string, and all three must outrank a
 * subsequence — "tor" finding "Torrents" should never sit below it finding
 * "moderaTiOn Reports". Within the subsequence tier, longer needles score
 * higher, because matching eight scattered characters is far less likely to be
 * coincidence than matching two.
 *
 * Both sides are accent- and case-folded, so "federation" reaches "Fédération".
 */
export function scoreMatch(
  haystack: string,
  needle: string,
  allowSubsequence = true
): number {
  if (!needle) return 1;

  const hay = foldForSearch(haystack);
  const seek = foldForSearch(needle);

  if (hay === seek) return 1000;
  if (hay.startsWith(seek)) return 800;
  if (hay.includes(seek)) return 500;

  if (!allowSubsequence) return 0;

  // Subsequence: every character of the needle appears in order, with anything
  // in between. This is what makes "adus" find "Admin · Users".
  let from = 0;
  for (const char of seek) {
    const at = hay.indexOf(char, from);
    if (at === -1) return 0;
    from = at + 1;
  }
  return 100 + seek.length * 5;
}

/**
 * Keyword hits are real but weaker evidence than a label hit: the word is not
 * on screen, so a result matching only through them looks unexplained. The
 * discount keeps them below anything the reader can actually see the reason for.
 */
const KEYWORD_DISCOUNT = 0.4;

/**
 * Keywords are matched no looser than a substring, and the reason is that they
 * are long. An admin section's keywords are its whole description, and over a
 * sentence a subsequence match succeeds almost always — measured: typing
 * "founder" surfaced "Earning Rules" and "Freeleech Pool" above the member
 * actually called founder, because those letters appear in order somewhere in
 * their descriptions. Subsequence stays on for labels, which are short enough
 * that "adus" reaching "Admin · Users" means something.
 */
export function scoreItem(item: PaletteItem, query: string): number {
  const onLabel = scoreMatch(item.label, query);
  if (onLabel > 0) return onLabel;
  if (!item.keywords) return 0;
  return scoreMatch(item.keywords, query, false) * KEYWORD_DISCOUNT;
}

/**
 * The ranked slice the palette renders.
 *
 * An empty query returns the items unchanged and untruncated — that is the
 * "here is everything you can reach" view you get on opening, and reordering or
 * cutting it would make the palette feel different every time it opens.
 *
 * Ties keep their input order (`Array.prototype.sort` is stable), so the order
 * the caller assembled the groups in survives, and equally-good matches do not
 * shuffle between keystrokes.
 */
export function rankPaletteItems(
  items: PaletteItem[],
  query: string,
  limit = 40
): PaletteItem[] {
  if (!query.trim()) return items;

  return items
    .map((item) => ({ item, score: scoreItem(item, query) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((scored) => scored.item);
}
