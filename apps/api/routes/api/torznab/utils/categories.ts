/**
 * Torznab Category Mapping
 * Maps Trackarr categories to Newznab standard category IDs
 */

import { db } from '@trackarr/db';

// Standard Newznab category hierarchy
export const NEWZNAB_CATEGORIES = {
  // Movies
  MOVIES: 2000,
  MOVIES_FOREIGN: 2010,
  MOVIES_OTHER: 2020,
  MOVIES_SD: 2030,
  MOVIES_HD: 2040,
  MOVIES_UHD: 2045,
  MOVIES_BLURAY: 2050,
  MOVIES_3D: 2060,
  // TV
  TV: 5000,
  TV_WEBDL: 5010,
  TV_FOREIGN: 5020,
  TV_SD: 5030,
  TV_HD: 5040,
  TV_UHD: 5045,
  TV_OTHER: 5050,
  TV_SPORT: 5060,
  TV_ANIME: 5070,
  TV_DOCUMENTARY: 5080,
  // Audio
  AUDIO: 3000,
  AUDIO_MP3: 3010,
  AUDIO_VIDEO: 3020,
  AUDIO_LOSSLESS: 3040,
  // PC
  PC: 4000,
  PC_0DAY: 4010,
  PC_ISO: 4020,
  PC_MAC: 4030,
  PC_MOBILE: 4040,
  PC_GAMES: 4050,
  // Console
  CONSOLE: 1000,
  CONSOLE_NDS: 1010,
  CONSOLE_PSP: 1020,
  CONSOLE_WII: 1030,
  CONSOLE_XBOX: 1040,
  CONSOLE_PS3: 1080,
  CONSOLE_PS4: 1180,
  // Books
  BOOKS: 7000,
  BOOKS_MAGAZINES: 7010,
  BOOKS_EBOOK: 7020,
  BOOKS_COMICS: 7030,
  // Other
  OTHER: 8000,
  OTHER_MISC: 8010,
} as const;

// Default mapping based on common category names/slugs
// This can be enhanced with database field later
const DEFAULT_SLUG_MAPPINGS: Record<string, number> = {
  // Movies
  movies: NEWZNAB_CATEGORIES.MOVIES,
  'movies-hd': NEWZNAB_CATEGORIES.MOVIES_HD,
  'movies-uhd': NEWZNAB_CATEGORIES.MOVIES_UHD,
  'movies-sd': NEWZNAB_CATEGORIES.MOVIES_SD,
  'movies-4k': NEWZNAB_CATEGORIES.MOVIES_UHD,
  'movies-bluray': NEWZNAB_CATEGORIES.MOVIES_BLURAY,
  'movies-dvd': NEWZNAB_CATEGORIES.MOVIES_SD,
  'movies-remux': NEWZNAB_CATEGORIES.MOVIES_BLURAY,
  // TV
  tv: NEWZNAB_CATEGORIES.TV,
  'tv-hd': NEWZNAB_CATEGORIES.TV_HD,
  'tv-uhd': NEWZNAB_CATEGORIES.TV_UHD,
  'tv-sd': NEWZNAB_CATEGORIES.TV_SD,
  'tv-4k': NEWZNAB_CATEGORIES.TV_UHD,
  'tv-anime': NEWZNAB_CATEGORIES.TV_ANIME,
  'tv-documentary': NEWZNAB_CATEGORIES.TV_DOCUMENTARY,
  'tv-sport': NEWZNAB_CATEGORIES.TV_SPORT,
  // Audio
  audio: NEWZNAB_CATEGORIES.AUDIO,
  music: NEWZNAB_CATEGORIES.AUDIO,
  'music-mp3': NEWZNAB_CATEGORIES.AUDIO_MP3,
  'music-flac': NEWZNAB_CATEGORIES.AUDIO_LOSSLESS,
  'music-lossless': NEWZNAB_CATEGORIES.AUDIO_LOSSLESS,
  // Games
  games: NEWZNAB_CATEGORIES.PC_GAMES,
  'games-pc': NEWZNAB_CATEGORIES.PC_GAMES,
  'games-console': NEWZNAB_CATEGORIES.CONSOLE,
  'games-ps4': NEWZNAB_CATEGORIES.CONSOLE_PS4,
  'games-ps3': NEWZNAB_CATEGORIES.CONSOLE_PS3,
  'games-xbox': NEWZNAB_CATEGORIES.CONSOLE_XBOX,
  'games-switch': NEWZNAB_CATEGORIES.CONSOLE,
  // Software
  software: NEWZNAB_CATEGORIES.PC,
  apps: NEWZNAB_CATEGORIES.PC_0DAY,
  applications: NEWZNAB_CATEGORIES.PC_0DAY,
  // Books
  books: NEWZNAB_CATEGORIES.BOOKS,
  ebooks: NEWZNAB_CATEGORIES.BOOKS_EBOOK,
  comics: NEWZNAB_CATEGORIES.BOOKS_COMICS,
  // Anime
  anime: NEWZNAB_CATEGORIES.TV_ANIME,
  // Other
  other: NEWZNAB_CATEGORIES.OTHER,
  misc: NEWZNAB_CATEGORIES.OTHER_MISC,
};

// Custom-category Torznab IDs live in 100000–199999 — same convention used
// by Jackett/Prowlarr for tracker-specific categories. They never collide
// with the standard Newznab numbering (1000–8999) and consumers (Sonarr,
// Radarr, etc.) ignore them unless explicitly subscribed to.
const SYNTHETIC_BASE = 100_000;
const SYNTHETIC_RANGE = 100_000;

/**
 * Stable string→int hash. Same input always produces the same id, so a
 * Trackarr category that has no explicit `newznabId` keeps the same
 * synthetic Torznab id across API restarts (and across containers in a
 * deployment) — Prowlarr's saved "include this category" mappings stay
 * valid.
 */
function syntheticIdFor(uuid: string): number {
  let h = 0;
  for (let i = 0; i < uuid.length; i++) {
    h = ((h << 5) - h + uuid.charCodeAt(i)) | 0;
  }
  return SYNTHETIC_BASE + (Math.abs(h) % SYNTHETIC_RANGE);
}

/**
 * Get Newznab category ID for a Trackarr category.
 * Priority: 1) Database newznabId, 2) Slug-based mapping, 3) Stable synthetic id.
 *
 * Note: previously fell through to OTHER (8000), which made every unmapped
 * Trackarr category collapse into the same id. Prowlarr then displayed
 * every torrent under "Other" and the caps tree had no way to distinguish
 * them. The synthetic id keeps each Trackarr category individually
 * addressable; the caps tree separately groups it under a Newznab parent
 * for *arr compatibility.
 */
export function getNewznabCategoryId(
  category: {
    id: string;
    slug: string;
    parentId?: string | null;
    newznabId?: number | null;
  } | null
): number {
  if (!category) return NEWZNAB_CATEGORIES.OTHER;
  if (category.newznabId) return category.newznabId;
  const mapped = DEFAULT_SLUG_MAPPINGS[category.slug.toLowerCase()];
  if (mapped) return mapped;
  return syntheticIdFor(category.id);
}

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  newznabId: number | null;
}

interface ResolvedCategory extends CategoryRow {
  newznabId: number;
  newznabParent: number;
}

/**
 * Map a category to its Newznab "main" parent (1000/2000/.../8000).
 *
 *   - If the resolved id is in the standard 1xxx–8xxx range, use floor/1000.
 *   - Otherwise (synthetic id), inherit from the Trackarr parent chain
 *     when one of the ancestors maps to a standard range.
 *   - Failing that, fall back to OTHER (8000).
 *
 * This is what makes a Trackarr category named "Films français" with no
 * `newznabId` still appear under "Movies" in Prowlarr, instead of "Other".
 */
function resolveNewznabParent(
  cat: CategoryRow & { newznabId: number },
  byId: Map<string, CategoryRow>
): number {
  if (cat.newznabId < SYNTHETIC_BASE) {
    return Math.floor(cat.newznabId / 1000) * 1000;
  }
  // Climb the Trackarr parent chain looking for a standard-range ancestor.
  const visited = new Set<string>();
  let cursor: string | null = cat.parentId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const parent = byId.get(cursor);
    if (!parent) break;
    const parentId = getNewznabCategoryId(parent);
    if (parentId < SYNTHETIC_BASE) {
      return Math.floor(parentId / 1000) * 1000;
    }
    cursor = parent.parentId;
  }
  // Last resort: try slug/name heuristic on the cat itself.
  const slugMain = inferMainFromSlug(cat);
  if (slugMain) return slugMain;
  return NEWZNAB_CATEGORIES.OTHER;
}

/**
 * Best-effort slug-based main-category guess for fully custom categories
 * with no parent and no explicit newznab mapping. Cheap heuristic; the
 * real fix is for the operator to set `newznab_id` on the row.
 */
function inferMainFromSlug(cat: { slug?: string; name?: string }): number | null {
  // Drop accents so "séries" matches the same pattern as "series".
  const text = `${cat.slug || ''} ${cat.name || ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  // Anchored on word starts; trailing letters tolerated ("films", "series",
  // "movies") so we don't depend on exact pluralisation.
  if (/\b(?:movie|film|cinema|cine)/.test(text)) return NEWZNAB_CATEGORIES.MOVIES;
  if (/\b(?:tv|seri|episod|saison|season|show|anime)/.test(text))
    return NEWZNAB_CATEGORIES.TV;
  if (/\b(?:audio|music|musique|song|album)/.test(text))
    return NEWZNAB_CATEGORIES.AUDIO;
  if (/\b(?:book|ebook|livre|comic|magazine|bd)\b/.test(text))
    return NEWZNAB_CATEGORIES.BOOKS;
  if (/\b(?:console|xbox|playstation|nintendo|switch|wii)/.test(text))
    return NEWZNAB_CATEGORIES.CONSOLE;
  if (/\b(?:game|jeu)/.test(text)) return NEWZNAB_CATEGORIES.PC;
  if (/\b(?:software|app|program|logiciel)/.test(text))
    return NEWZNAB_CATEGORIES.PC;
  return null;
}

/**
 * Get all categories with their resolved Newznab id + main parent.
 */
export async function getCategoriesWithNewznabIds(): Promise<ResolvedCategory[]> {
  const rows = (await db.query.categories.findMany({
    orderBy: (cat, { asc }) => [asc(cat.name)],
  })) as CategoryRow[];

  const byId = new Map(rows.map((c) => [c.id, c]));

  return rows.map((cat) => {
    const newznabId = getNewznabCategoryId(cat);
    const newznabParent = resolveNewznabParent({ ...cat, newznabId }, byId);
    return { ...cat, newznabId, newznabParent };
  });
}

/**
 * Build Newznab category tree for the capabilities response.
 *
 *   - One main entry per used Newznab parent (Movies, TV, …).
 *   - Each Trackarr category is exposed as a `<subcat>` of its parent,
 *     with the operator-configured Trackarr name (not a hardcoded
 *     Newznab label).
 *   - Subcats are deduped by id — the previous version of this code
 *     emitted two `<subcat id="4050"/>` entries when the seeded "Games"
 *     parent collided with its "PC" child, making Prowlarr's category
 *     picker look broken.
 */
export async function buildCategoryTree() {
  const categories = await getCategoriesWithNewznabIds();

  const mainCats = new Map<
    number,
    {
      name: string;
      subcats: Map<number, string>; // id → name (preserves order, dedupes)
    }
  >();

  for (const cat of categories) {
    const main = cat.newznabParent;
    if (!mainCats.has(main)) {
      mainCats.set(main, {
        // Prefer the Trackarr-configured name when this row IS the main
        // category itself (i.e. its newznabId equals the main parent).
        // Otherwise use the standard Newznab label so consumers map it.
        name:
          cat.newznabId === main && cat.newznabId < SYNTHETIC_BASE
            ? cat.name
            : standardMainName(main),
        subcats: new Map(),
      });
    } else if (cat.newznabId === main && cat.newznabId < SYNTHETIC_BASE) {
      // A later category claims to BE this main parent; let it own the name.
      mainCats.get(main)!.name = cat.name;
    }

    // Don't list the main category as a subcat of itself.
    if (cat.newznabId === main) continue;

    const bucket = mainCats.get(main)!;
    if (!bucket.subcats.has(cat.newznabId)) {
      bucket.subcats.set(cat.newznabId, cat.name);
    }
  }

  // Sort main categories so the response order is deterministic.
  return Array.from(mainCats.entries())
    .sort(([a], [b]) => a - b)
    .map(([id, data]) => ({
      id,
      name: data.name,
      subcats:
        data.subcats.size > 0
          ? Array.from(data.subcats.entries()).map(([sid, sname]) => ({
              id: sid,
              name: sname,
            }))
          : undefined,
    }));
}

function standardMainName(catId: number): string {
  switch (catId) {
    case 1000:
      return 'Console';
    case 2000:
      return 'Movies';
    case 3000:
      return 'Audio';
    case 4000:
      return 'PC';
    case 5000:
      return 'TV';
    case 6000:
      return 'XXX';
    case 7000:
      return 'Books';
    case 8000:
      return 'Other';
    default:
      return 'Other';
  }
}

/**
 * Filter Trackarr categories by Newznab category IDs.
 * Used for search filtering: `?cat=2040` returns Trackarr cats whose
 * resolved newznabId is 2040, and `?cat=2000` returns every cat under
 * the Movies main parent (synthetic ids included, via newznabParent).
 */
export async function filterCategoriesByNewznab(
  newznabIds: number[]
): Promise<string[]> {
  if (newznabIds.length === 0) return [];

  const categories = await getCategoriesWithNewznabIds();

  return categories
    .filter((cat) => {
      for (const nId of newznabIds) {
        if (cat.newznabId === nId) return true;
        // Main-parent match: nId is a 1xxx/2xxx/.../8xxx root.
        if (nId % 1000 === 0 && cat.newznabParent === nId) return true;
      }
      return false;
    })
    .map((cat) => cat.id);
}
