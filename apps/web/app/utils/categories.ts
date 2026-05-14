/**
 * Shared category helpers for the upload + edit forms (and any other
 * page that needs to reason about a torrent's category). The same
 * findCategory + kind-detection logic used to be duplicated; centralising
 * it keeps "movie", "tv", "game", "book" and "other" classifications
 * consistent so the Identity (IMDb/TMDb/TVDB/IGDB/Open Library)
 * section appears or hides on both pages by exactly the same rule.
 *
 * "Kind" rules:
 *   - newznabId in 1000-1999 (console) or 4000-4999 (PC) → game
 *   - newznabId in 2000-2999 → movie
 *   - newznabId in 5000-5999 → tv (covers anime + tv shows)
 *   - newznabId in 7000-7999 → book (ebooks, comics, mags — Newznab
 *     groups them under one decade)
 *   - else, fall back to a slug/name keyword match (handles installs that
 *     haven't filled in newznabId yet)
 *   - else → 'other' (audio, software, …) — IDs section hidden.
 */

export interface CategoryNode {
  id: string;
  name: string;
  slug?: string;
  newznabId?: number | null;
  // Operator-set canonical type — preferred over heuristics when
  // present. Lets, e.g., XXX/Hentai opt into the TV namespace even
  // though its newznab id sits outside the 5000-range.
  type?: 'movie' | 'tv' | 'game' | 'book' | null;
  subcategories?: CategoryNode[];
}

export type CategoryKind = 'movie' | 'tv' | 'game' | 'book' | 'other';

export function findCategory(
  cats: CategoryNode[] | null | undefined,
  id: string | null | undefined
): CategoryNode | null {
  if (!cats || !id) return null;
  for (const c of cats) {
    if (c.id === id) return c;
    if (c.subcategories) {
      const found = findCategory(c.subcategories, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Resolve a category to one of three kinds. The IDs section on the
 * upload/edit forms only renders when the kind is 'movie' or 'tv'.
 *
 * Resolution order:
 *   1. `category.type` if the operator set one — explicit wins.
 *   2. Newznab id range (2xxx → movie, 5xxx → tv).
 *   3. Slug / name keyword heuristic.
 *   4. 'other'.
 */
export function categoryKind(cat: CategoryNode | null | undefined): CategoryKind {
  if (!cat) return 'other';
  if (
    cat.type === 'movie' ||
    cat.type === 'tv' ||
    cat.type === 'game' ||
    cat.type === 'book'
  ) {
    return cat.type;
  }
  const nz = cat.newznabId;
  if (typeof nz === 'number') {
    if (nz >= 2000 && nz < 3000) return 'movie';
    if (nz >= 5000 && nz < 6000) return 'tv';
    // Newznab 1xxx (console) + 4xxx (PC) both map to IGDB.
    if ((nz >= 1000 && nz < 2000) || (nz >= 4000 && nz < 5000)) return 'game';
    // Newznab 7xxx is the book/ebook/comic/magazine decade.
    if (nz >= 7000 && nz < 8000) return 'book';
  }
  // Strip diacritics so "séries" matches "seri".
  const text = `${cat.slug || ''} ${cat.name || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (/\b(?:tv|seri|episod|saison|season|show|anime)/.test(text)) return 'tv';
  if (/\b(?:movie|film|cinema|cine)/.test(text)) return 'movie';
  if (/\b(?:game|games|jeu|jeux|console|playstation|xbox|nintendo|switch)/.test(text)) {
    return 'game';
  }
  if (
    /\b(?:book|ebook|e-book|epub|mobi|azw3|livre|livres|comics?|bd|manga|magazine|revue)/.test(
      text
    )
  ) {
    return 'book';
  }
  return 'other';
}

/** Convenience: 'movie' | 'tv' | 'game' | 'book' (the `MediaTypeHint`
 *  shape) or undefined when the category is 'other'. */
export function categoryTypeHint(
  cat: CategoryNode | null | undefined
): 'movie' | 'tv' | 'game' | 'book' | undefined {
  const kind = categoryKind(cat);
  return kind === 'other' ? undefined : kind;
}

/**
 * Flatten the category tree for a `<select>` while indenting
 * subcategories so the hierarchy stays visible.
 */
export function getFlattenedCategories(
  cats: CategoryNode[] | null | undefined,
  prefix = ''
): Array<{ id: string; name: string }> {
  if (!cats) return [];
  let result: Array<{ id: string; name: string }> = [];
  for (const c of cats) {
    result.push({ id: c.id, name: prefix + c.name });
    if (c.subcategories) {
      result = result.concat(
        getFlattenedCategories(c.subcategories, prefix + '╚=> ')
      );
    }
  }
  return result;
}
