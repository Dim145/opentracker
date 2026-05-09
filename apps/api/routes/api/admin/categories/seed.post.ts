import { db, schema } from '@trackarr/db';
import { randomUUID } from 'crypto';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

// Recommended Torznab-compatible categories with proper Newznab IDs.
// `newznabId: null` means "no specific Newznab mapping" — the runtime
// resolver picks a synthetic id and groups the row under a Newznab parent
// inferred from its children or slug.
interface SeedCategory {
  name: string;
  slug: string;
  newznabId: number | null;
  // The whole XXX subtree is tagged adult so it can be filtered out
  // for users who haven't opted in. Tag the parent and every child
  // explicitly so a single SELECT filters them with no recursion.
  isAdult?: boolean;
  // Canonical media type — drives the TMDb hint on the upload/edit
  // forms. 'movie' uses the /movie namespace, 'tv' uses /tv. Leave
  // undefined for non-media categories (Audio, Software, …).
  type?: 'movie' | 'tv';
  subcategories: Array<{
    name: string;
    slug: string;
    newznabId: number | null;
    isAdult?: boolean;
    type?: 'movie' | 'tv';
  }>;
}

const SEED_CATEGORIES: SeedCategory[] = [
  // Movies
  {
    name: 'Movies',
    slug: 'movies',
    newznabId: 2000,
    type: 'movie',
    subcategories: [
      { name: 'HD', slug: 'movies-hd', newznabId: 2040, type: 'movie' },
      { name: 'UHD/4K', slug: 'movies-uhd', newznabId: 2045, type: 'movie' },
      { name: 'SD', slug: 'movies-sd', newznabId: 2030, type: 'movie' },
      { name: 'Blu-Ray', slug: 'movies-bluray', newznabId: 2050, type: 'movie' },
    ],
  },
  // TV
  {
    name: 'TV',
    slug: 'tv',
    newznabId: 5000,
    type: 'tv',
    subcategories: [
      { name: 'HD', slug: 'tv-hd', newznabId: 5040, type: 'tv' },
      { name: 'UHD/4K', slug: 'tv-uhd', newznabId: 5045, type: 'tv' },
      { name: 'SD', slug: 'tv-sd', newznabId: 5030, type: 'tv' },
      { name: 'Anime', slug: 'tv-anime', newznabId: 5070, type: 'tv' },
      { name: 'Documentary', slug: 'tv-documentary', newznabId: 5080, type: 'tv' },
    ],
  },
  // Audio
  {
    name: 'Audio',
    slug: 'audio',
    newznabId: 3000,
    subcategories: [
      { name: 'MP3', slug: 'audio-mp3', newznabId: 3010 },
      { name: 'Lossless', slug: 'audio-lossless', newznabId: 3040 },
    ],
  },
  // Games — parent has no Newznab id of its own (Newznab splits games
  // between PC=4050 and Console=1000), so leave it null and let each
  // child carry its own mapping. Setting it to 4050 here used to
  // collide with the PC child and produced two <subcat id="4050"/>
  // entries in the caps response.
  {
    name: 'Games',
    slug: 'games',
    newznabId: null,
    subcategories: [
      { name: 'PC', slug: 'games-pc', newznabId: 4050 },
      { name: 'Console', slug: 'games-console', newznabId: 1000 },
      { name: 'PlayStation', slug: 'games-playstation', newznabId: 1180 },
      { name: 'Xbox', slug: 'games-xbox', newznabId: 1040 },
    ],
  },
  // Software
  {
    name: 'Software',
    slug: 'software',
    newznabId: 4000,
    subcategories: [
      { name: 'Windows', slug: 'software-windows', newznabId: 4020 },
      { name: 'Mac', slug: 'software-mac', newznabId: 4030 },
    ],
  },
  // Books
  {
    name: 'Books',
    slug: 'books',
    newznabId: 7000,
    subcategories: [
      { name: 'Ebooks', slug: 'books-ebooks', newznabId: 7020 },
      { name: 'Comics', slug: 'books-comics', newznabId: 7030 },
      { name: 'Magazines', slug: 'books-magazines', newznabId: 7010 },
    ],
  },
  // XXX — gated behind users.showAdultContent. Newznab maps the XXX
  // tree under 6000-6080 (DVD/WMV/XviD/x264/4K/Pack/ImgSet/Anime/SD).
  // We pick the closest semantic mapping per child; categories with
  // no canonical Newznab id (Jeux, VR, Ebooks) keep newznabId null
  // so the resolver assigns a synthetic one.
  {
    name: 'XXX',
    slug: 'xxx',
    newznabId: 6000,
    isAdult: true,
    subcategories: [
      // Films + VR are pure movie content; Hentai is animated series
      // (TMDb's /tv namespace covers them). Images/Jeux/Ebooks aren't
      // film/series content so they keep type undefined.
      {
        name: 'Films',
        slug: 'xxx-films',
        newznabId: 6040,
        isAdult: true,
        type: 'movie',
      },
      {
        name: 'Hentai',
        slug: 'xxx-hentai',
        newznabId: 6070,
        isAdult: true,
        type: 'tv',
      },
      { name: 'Images', slug: 'xxx-images', newznabId: 6060, isAdult: true },
      { name: 'Jeux', slug: 'xxx-jeux', newznabId: null, isAdult: true },
      {
        name: 'VR',
        slug: 'xxx-vr',
        newznabId: null,
        isAdult: true,
        type: 'movie',
      },
      { name: 'Ebooks', slug: 'xxx-ebooks', newznabId: null, isAdult: true },
    ],
  },
  // Other
  {
    name: 'Other',
    slug: 'other',
    newznabId: 8000,
    subcategories: [],
  },
];

export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.admin);
  await requireAdminSession(event);

  // Check if categories already exist
  const existingCategories = await db.query.categories.findMany();
  if (existingCategories.length > 0) {
    throw createError({
      statusCode: 400,
      message:
        'Categories already exist. Delete all categories first to re-seed.',
    });
  }

  let created = 0;

  for (const cat of SEED_CATEGORIES) {
    const parentId = randomUUID();

    // Create parent category
    await db.insert(schema.categories).values({
      id: parentId,
      name: cat.name,
      slug: cat.slug,
      parentId: null,
      newznabId: cat.newznabId,
      isAdult: cat.isAdult ?? false,
      type: cat.type ?? null,
      createdAt: new Date(),
    });
    created++;

    // Create subcategories
    for (const sub of cat.subcategories) {
      await db.insert(schema.categories).values({
        id: randomUUID(),
        name: sub.name,
        slug: sub.slug,
        parentId: parentId,
        newznabId: sub.newznabId,
        isAdult: sub.isAdult ?? false,
        type: sub.type ?? null,
        createdAt: new Date(),
      });
      created++;
    }
  }

  return { success: true, created };
});
