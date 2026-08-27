import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import {
  federatedFeedRows,
  magnetLink,
  newznabIdForType,
} from '../../utils/federation/feedRows';
import { makeCategory } from './helpers';

// The machine feeds' view of the mirror. Same gates as the human browse (active
// peer, not masked, adult opt-in), deduped by infohash, and — the point of the
// taxonomy bridge — filterable by a local category a partner named differently.

let counter = 0;

async function makePeer(): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    status: 'active',
    sharesWithThem: { catalog: true, social: false, accounts: false, swarm: false },
    acceptsFromThem: { catalog: true, social: false, accounts: false, swarm: false },
  });
  return id;
}

interface Row {
  peerId: string;
  infoHash?: string;
  name: string;
  seeders?: number;
  isAdult?: boolean;
  categorySlug?: string | null;
}

async function mirror(rows: Row[]): Promise<void> {
  await db.insert(schema.remoteTorrents).values(
    rows.map((r) => ({
      id: randomUUID(),
      peerId: r.peerId,
      remoteId: `sha256:${randomUUID().replace(/-/g, '')}`,
      infoHash: r.infoHash ?? (counter++).toString(16).padStart(40, 'b'),
      name: r.name,
      size: 1_000_000,
      seeders: r.seeders ?? 0,
      leechers: 0,
      isAdult: r.isAdult ?? false,
      categorySlug: r.categorySlug ?? 'movies',
      remoteCreatedAt: new Date(),
    })),
  );
}

describe('federated feed rows', () => {
  it('returns active, unmasked, non-adult rows deduped by infohash (best-seeded wins)', async () => {
    const p1 = await makePeer();
    const p2 = await makePeer();
    const hash = 'ab'.repeat(20);
    await mirror([
      { peerId: p1, infoHash: hash, name: 'Movie.1080p', seeders: 5 },
      { peerId: p2, infoHash: hash, name: 'Movie.1080p', seeders: 20 },
      { peerId: p1, infoHash: 'cd'.repeat(20), name: 'Adult.XXX', isAdult: true },
    ]);

    const rows = await federatedFeedRows({ showAdult: false, limit: 50 });
    const dedup = rows.filter((r) => r.infoHash === hash);
    expect(dedup.length).toBe(1);
    expect(dedup[0]!.seeders).toBe(20);
    expect(rows.some((r) => r.name === 'Adult.XXX')).toBe(false);
  });

  it('filters by search term', async () => {
    const p = await makePeer();
    await mirror([
      { peerId: p, name: 'The Matrix 1080p' },
      { peerId: p, name: 'Inception 2160p' },
    ]);
    const rows = await federatedFeedRows({ search: 'matrix', showAdult: false, limit: 50 });
    expect(rows.length).toBe(1);
    expect(rows[0]!.name).toContain('Matrix');
  });

  it('filters by a local category through a taxonomy mapping', async () => {
    const p = await makePeer();
    const catId = await makeCategory(); // random slug; 'films' can't match by convention
    await mirror([{ peerId: p, name: 'Foreign.Film', categorySlug: 'films' }]);

    expect(
      (await federatedFeedRows({ localCategoryIds: [catId], showAdult: false, limit: 50 }))
        .length,
    ).toBe(0);

    await db
      .insert(schema.remoteCategoryMap)
      .values({ id: randomUUID(), remoteSlug: 'films', localCategoryId: catId });

    const rows = await federatedFeedRows({
      localCategoryIds: [catId],
      showAdult: false,
      limit: 50,
    });
    expect(rows.some((r) => r.name === 'Foreign.Film')).toBe(true);
  });

  it('excludes masked rows; magnet and newznab helpers are correct', async () => {
    const p = await makePeer();
    const hash = 'ef'.repeat(20);
    await mirror([{ peerId: p, infoHash: hash, name: 'Masked.Release' }]);
    await db
      .insert(schema.remoteMasks)
      .values({ id: randomUUID(), scope: 'infohash', value: hash });

    const rows = await federatedFeedRows({ showAdult: false, limit: 50 });
    expect(rows.some((r) => r.infoHash === hash)).toBe(false);

    expect(magnetLink('abc', 'A B')).toBe('magnet:?xt=urn:btih:abc&dn=A%20B');
    expect(newznabIdForType('movie')).toBe(2000);
    expect(newznabIdForType('tv')).toBe(5000);
    expect(newznabIdForType(null)).toBeUndefined();
  });
});
