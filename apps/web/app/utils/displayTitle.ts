/**
 * Release names ("ReZERO.Starting.Life.in.Another.World.S01...") have
 * no whitespace, so the browser can't pick a natural break point —
 * it either overflows the container or gets a CSS rule like
 * `overflow-wrap: anywhere` and chops in the middle of a word.
 *
 * `withWrapHints` sprinkles **zero-width space** (`U+200B`) after
 * the conventional scene-name separators (`.`, `_`, `-`) so the
 * line breaker has somewhere obvious to split. The character is
 * invisible, doesn't appear when the user copies the text out of
 * the page (modern browsers strip it on copy), and is ignored by
 * screen readers. The result is a long title that wraps after a
 * dot — exactly where a human would have chosen — rather than
 * in the middle of "Director".
 *
 * Single dots inside short groups (e.g. `2.0`, `5.1`, `v1.2.3`)
 * still get a ZWSP, but in practice that's harmless: the line
 * breaker prefers earlier break opportunities and only falls
 * through to those when nothing better is available.
 */
export function withWrapHints(s: string): string {
  if (!s) return s;
  // Only inject the hint when the input has no whitespace at all;
  // a title that already has spaces wraps fine on its own.
  if (/\s/.test(s)) return s;
  return s.replace(/([._-])/g, '$1​');
}

/**
 * Picks a font-size class for the torrent detail page's title
 * based on character count. Long scene names get progressively
 * smaller so they fit the page width without overflowing, while
 * short human-readable titles keep the dramatic `text-2xl`.
 *
 * Returned values are Tailwind utility classes. Callers should
 * `:class` them directly into the heading.
 */
export function titleSizeClass(s: string | null | undefined): string {
  const len = (s || '').length;
  if (len >= 90) return 'text-base sm:text-lg';
  if (len >= 60) return 'text-lg sm:text-xl';
  return 'text-2xl';
}
