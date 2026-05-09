import { db, schema } from '../server/db';
import { randomUUID } from 'crypto';

// Torznab-compatible categories with proper Newznab IDs
const SEED_CATEGORIES = [
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
  // Games
  {
    name: 'Games',
    slug: 'games',
    newznabId: 4050,
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
  // XXX — gated behind users.showAdultContent on the read path
  {
    name: 'XXX',
    slug: 'xxx',
    newznabId: 6000,
    isAdult: true,
    subcategories: [
      { name: 'Films', slug: 'xxx-films', newznabId: 6040, isAdult: true, type: 'movie' },
      { name: 'Hentai', slug: 'xxx-hentai', newznabId: 6070, isAdult: true, type: 'tv' },
      { name: 'Images', slug: 'xxx-images', newznabId: 6060, isAdult: true },
      { name: 'Jeux', slug: 'xxx-jeux', newznabId: null, isAdult: true },
      { name: 'VR', slug: 'xxx-vr', newznabId: null, isAdult: true, type: 'movie' },
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

async function seed() {
  // Check if categories already exist
  const existing = await db.query.categories.findFirst();
  if (existing) {
    console.log('✓ Categories already exist, skipping seed');
    process.exit(0);
  }

  console.log('🌱 Seeding Torznab-compatible categories...');

  let created = 0;

  for (const cat of SEED_CATEGORIES) {
    const parentId = randomUUID();

    // Create parent category
    await db
      .insert(schema.categories)
      .values({
        id: parentId,
        name: cat.name,
        slug: cat.slug,
        parentId: null,
        newznabId: cat.newznabId,
        isAdult: (cat as { isAdult?: boolean }).isAdult ?? false,
        type: (cat as { type?: 'movie' | 'tv' }).type ?? null,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    console.log(`  ✓ ${cat.name} [${cat.newznabId}]`);
    created++;

    // Create subcategories
    for (const sub of cat.subcategories) {
      await db
        .insert(schema.categories)
        .values({
          id: randomUUID(),
          name: sub.name,
          slug: sub.slug,
          parentId: parentId,
          newznabId: sub.newznabId,
          isAdult: (sub as { isAdult?: boolean }).isAdult ?? false,
          type: (sub as { type?: 'movie' | 'tv' }).type ?? null,
          createdAt: new Date(),
        })
        .onConflictDoNothing();
      console.log(`    ↳ ${sub.name} [${sub.newznabId}]`);
      created++;
    }
  }

  console.log(`\n✅ Created ${created} Torznab-compatible categories`);
  process.exit(0);
}

seed();
