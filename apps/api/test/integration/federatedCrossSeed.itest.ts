import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import {
  federatedContentAvailability,
  federatedCrossSeedMatches,
} from '../../utils/federation/crossSeed';

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

let counter = 0;
async function mirror(
  peerId: string,
  over: {
    name: string;
    contentRootV2?: string | null;
    contentSignature?: string | null;
    seeders?: number;
    leechers?: number;
    infoHash?: string;
  },
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.remoteTorrents).values({
    id,
    peerId,
    remoteId: `sha256:${randomUUID().replace(/-/g, '')}`,
    infoHash: over.infoHash ?? (counter++).toString(16).padStart(40, 'b'),
    name: over.name,
    size: 1000,
    seeders: over.seeders ?? 1,
    leechers: over.leechers ?? 0,
    isAdult: false,
    contentRootV2: over.contentRootV2 ?? null,
    contentSignature: over.contentSignature ?? null,
    remoteDetailUrl: 'https://origin.example/t/1',
    remoteCreatedAt: new Date(),
  });
  return id;
}

const V2A = 'a'.repeat(64);
const V2B = 'b'.repeat(64);
const SIG = 'sig-shared';

describe('federatedCrossSeedMatches (M2)', () => {
  it('matches by v2 content root and rejects a different root', async () => {
    const p = await makePeer();
    await mirror(p, { name: 'Same.v2', contentRootV2: V2A });
    await mirror(p, { name: 'Different.v2', contentRootV2: V2B });

    const matches = await federatedCrossSeedMatches({ contentRootV2: V2A, contentSignature: null });
    expect(matches.map((m) => m.name)).toEqual(['Same.v2']);
    expect(matches[0]!.matchType).toBe('v2');
  });

  it('falls back to signature for a v1-only partner row, but a contradicting v2 wins', async () => {
    const p = await makePeer();
    await mirror(p, { name: 'V1.partner', contentRootV2: null, contentSignature: SIG });
    await mirror(p, { name: 'V2.contradicts', contentRootV2: V2B, contentSignature: SIG });

    // Source has a v2 root and a signature. The v1-only partner matches by
    // signature; the partner whose v2 root differs is provably NOT this content.
    const matches = await federatedCrossSeedMatches({ contentRootV2: V2A, contentSignature: SIG });
    expect(matches.map((m) => m.name)).toEqual(['V1.partner']);
    expect(matches[0]!.matchType).toBe('signature');
  });

  it('matches by signature when the source itself is v1-only', async () => {
    const p = await makePeer();
    await mirror(p, { name: 'Sig.hit', contentRootV2: V2B, contentSignature: SIG });

    const matches = await federatedCrossSeedMatches({ contentRootV2: null, contentSignature: SIG });
    expect(matches.map((m) => m.name)).toEqual(['Sig.hit']);
    expect(matches[0]!.matchType).toBe('signature');
  });

  it('excludes masked rows and returns nothing without a key', async () => {
    const p = await makePeer();
    const id = await mirror(p, { name: 'Masked', contentRootV2: V2A });
    const masked = await db.query.remoteTorrents.findFirst({
      where: (t, { eq }) => eq(t.id, id),
      columns: { infoHash: true },
    });
    await db
      .insert(schema.remoteMasks)
      .values({ id: randomUUID(), scope: 'infohash', value: masked!.infoHash });

    expect(await federatedCrossSeedMatches({ contentRootV2: V2A, contentSignature: null })).toEqual([]);
    expect(await federatedCrossSeedMatches({ contentRootV2: null, contentSignature: null })).toEqual([]);
  });

  describe('federatedContentAvailability (mesh health signal)', () => {
    it('sums seeders/leechers over distinct content-equivalent releases', async () => {
      const p1 = await makePeer();
      const p2 = await makePeer();
      await mirror(p1, { name: 'A', contentRootV2: V2A, seeders: 5, leechers: 1 });
      await mirror(p2, { name: 'B', contentRootV2: V2A, seeders: 20, leechers: 3 });

      const avail = await federatedContentAvailability({ contentRootV2: V2A, contentSignature: null });
      expect(avail.releases).toBe(2);
      expect(avail.seeders).toBe(25);
      expect(avail.leechers).toBe(4);
    });

    it('dedupes by infohash, keeping the best-seeded copy', async () => {
      const p1 = await makePeer();
      const p2 = await makePeer();
      const shared = 'ee'.repeat(20);
      await mirror(p1, { name: 'Copy1', contentRootV2: V2A, seeders: 3, infoHash: shared });
      await mirror(p2, { name: 'Copy2', contentRootV2: V2A, seeders: 9, infoHash: shared });

      const avail = await federatedContentAvailability({ contentRootV2: V2A, contentSignature: null });
      expect(avail.releases).toBe(1);
      expect(avail.seeders).toBe(9);
    });

    it('is zero without a key', async () => {
      const avail = await federatedContentAvailability({ contentRootV2: null, contentSignature: null });
      expect(avail).toEqual({ releases: 0, seeders: 0, leechers: 0 });
    });
  });
});
