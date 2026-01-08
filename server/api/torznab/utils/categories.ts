/**
 * Torznab Category Mapping
 * Maps Trackarr categories to Newznab standard category IDs
 */

import { db } from '../../../db';

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

/**
 * Get Newznab category ID for a Trackarr category
 * Priority: 1) Database newznabId field, 2) Slug-based mapping, 3) Fallback to OTHER
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

  // Priority 1: Use database-configured newznabId if set
  if (category.newznabId) return category.newznabId;

  // Priority 2: Check slug-based mapping
  const mapped = DEFAULT_SLUG_MAPPINGS[category.slug.toLowerCase()];
  if (mapped) return mapped;

  // Fallback to OTHER
  return NEWZNAB_CATEGORIES.OTHER;
}

/**
 * Get all categories with their Newznab mappings
 */
export async function getCategoriesWithNewznabIds(): Promise<
  Array<{
    id: string;
    name: string;
    slug: string;
    parentId: string | null;
    newznabId: number;
  }>
> {
  const categories = await db.query.categories.findMany({
    orderBy: (cat, { asc }) => [asc(cat.name)],
  });

  return categories.map((cat) => ({
    ...cat,
    newznabId: getNewznabCategoryId(cat),
  }));
}

/**
 * Build Newznab category tree for capabilities response
 */
export async function buildCategoryTree() {
  const categories = await getCategoriesWithNewznabIds();

  // Group by parent categories (Newznab main categories)
  const mainCats: Map<
    number,
    { name: string; subcats: Array<{ id: number; name: string }> }
  > = new Map();

  for (const cat of categories) {
    const mainCatId = Math.floor(cat.newznabId / 1000) * 1000;

    if (!mainCats.has(mainCatId)) {
      mainCats.set(mainCatId, {
        name: getMainCategoryName(mainCatId),
        subcats: [],
      });
    }

    // Add as subcat if it's not exactly the main category
    if (cat.newznabId !== mainCatId) {
      mainCats.get(mainCatId)!.subcats.push({
        id: cat.newznabId,
        name: cat.name,
      });
    }
  }

  return Array.from(mainCats.entries()).map(([id, data]) => ({
    id,
    name: data.name,
    subcats: data.subcats.length > 0 ? data.subcats : undefined,
  }));
}

function getMainCategoryName(catId: number): string {
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
 * Filter Trackarr categories by Newznab category IDs
 * Used for search filtering
 */
export async function filterCategoriesByNewznab(
  newznabIds: number[]
): Promise<string[]> {
  if (newznabIds.length === 0) return [];

  const categories = await getCategoriesWithNewznabIds();

  // Match exact IDs or parent IDs (e.g., 2000 matches 2040, 2050, etc.)
  return categories
    .filter((cat) => {
      for (const nId of newznabIds) {
        // Exact match
        if (cat.newznabId === nId) return true;
        // Parent match (e.g., 2000 matches all 2xxx)
        if (nId % 1000 === 0 && Math.floor(cat.newznabId / 1000) * 1000 === nId)
          return true;
      }
      return false;
    })
    .map((cat) => cat.id);
}
