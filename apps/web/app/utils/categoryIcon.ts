/**
 * Resolve the Phosphor icon name to use for a torrent based on its
 * category. Priority order:
 *
 *   1. `category.icon` — explicit override picked by the operator in
 *      the admin Categories form. Wins unconditionally when set, so
 *      the admin can override the type-derived default with a
 *      category-specific glyph (e.g. "ph:popcorn-bold" for a Film
 *      Festival subcategory).
 *
 *   2. `category.type` — derived default for the four metadata
 *      buckets the upload form already routes against. Keeps the
 *      auto-fallback meaningful for the operator who never bothers
 *      filling the explicit icon column.
 *
 *   3. Generic `ph:file-zip-bold` — when neither field is set, fall
 *      back to "this is a torrent file" rather than rendering an
 *      empty cell.
 *
 * Returning the string lets callers drop it straight into
 * `<Icon :name="...">` without any conditional rendering.
 */
type CategoryLike = {
  icon?: string | null;
  type?: string | null;
} | null | undefined;

const TYPE_FALLBACK: Record<string, string> = {
  movie: 'ph:film-strip-bold',
  tv: 'ph:television-bold',
  game: 'ph:game-controller-bold',
  book: 'ph:book-bold',
};

const GENERIC_FALLBACK = 'ph:file-zip-bold';

export function getCategoryIcon(category: CategoryLike): string {
  if (!category) return GENERIC_FALLBACK;
  if (category.icon) return category.icon;
  if (category.type && TYPE_FALLBACK[category.type]) {
    return TYPE_FALLBACK[category.type]!;
  }
  return GENERIC_FALLBACK;
}
