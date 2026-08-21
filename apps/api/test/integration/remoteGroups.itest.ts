import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  listRemoteGroups,
  partnerReleaseCounts,
} from '../../utils/remoteGroups';

// The federated mirror, folded by work.
//
// One property carries this whole file: **the same release lives on every
// partner that has it**. The local catalogue has no such thing — a row is a
// torrent — so every count over the mirror has to be over DISTINCT releases,
// never over rows. Get it wrong and a group claims three times the content it
// holds, which does not look like a bug. It looks like a well-stocked
// catalogue, and it is the single most likely way this code goes wrong.
//
// The second property is that the two catalogues meet at a badge, not at a
// merge: `partnerReleaseCounts` is what tells a member that somebody else has
// the season they are missing.

let counter = 0;

async function makePeer(
  over: Partial<typeof schema.federationPeers.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    displayName: `Peer ${id.slice(0, 4)}`,
    status: 'active',
    sharesWithThem: { catalog: true, social: false, accounts: false, swarm: false },
    acceptsFromThem: { catalog: true, social: false, accounts: false, swarm: false },
    ...over,
  });
  return id;
}

interface MirrorRow {
  peerId: string;
  name: string;
  /** What makes two rows the same release across partners. */
  contentSignature?: string | null;
  size?: number;
  tmdbId?: string | null;
  igdbId?: string | null;
  openlibraryId?: string | null;
  season?: number | null;
  episode?: number | null;
  seeders?: number;
  isAdult?: boolean;
  /** Left null on purpose by some tests — an older feed omitted it. */
  remoteCreatedAt?: Date | null;
}

async function mirror(rows: MirrorRow[]): Promise<void> {
  await db.insert(schema.remoteTorrents).values(
    rows.map((r) => ({
      id: randomUUID(),
      peerId: r.peerId,
      remoteId: `r-${counter}`,
      infoHash: (counter++).toString(16).padStart(40, 'b'),
      contentSignature: r.contentSignature ?? null,
      name: r.name,
      size: r.size ?? 1_000_000,
      tmdbId: r.tmdbId ?? null,
      igdbId: r.igdbId ?? null,
      openlibraryId: r.openlibraryId ?? null,
      season: r.season ?? null,
      episode: r.episode ?? null,
      seeders: r.seeders ?? 0,
      leechers: 0,
      isAdult: r.isAdult ?? false,
      remoteCreatedAt:
        r.remoteCreatedAt === undefined ? new Date() : r.remoteCreatedAt,
    })),
  );
}

/** A local torrent, so the badge has something to hang off. */
async function local(tmdbId: string, name: string): Promise<void> {
  await db.insert(schema.torrents).values({
    id: randomUUID(),
    infoHash: (counter++).toString(16).padStart(40, 'c'),
    name,
    size: 1_000_000,
    tmdbId,
    moderationStatus: 'accepted',
  });
}

const page = { limit: 25, offset: 0, showAdult: true };

beforeEach(() => {
  counter = 0;
});

describe('listRemoteGroups', () => {
  it('counts a release once however many partners carry it', async () => {
    // Two partners, the same six episodes, the same content signatures. Six
    // releases — not twelve.
    const a = await makePeer();
    const b = await makePeer();
    for (const peerId of [a, b]) {
      await mirror(
        Array.from({ length: 6 }, (_, i) => ({
          peerId,
          name: `Show.S04E0${i + 1}.2160p-NTb`,
          contentSignature: `sig-e${i + 1}`,
          tmdbId: 'tv/1',
          season: 4,
          episode: i + 1,
        })),
      );
    }

    const { groups, total } = await listRemoteGroups(page);
    expect(total).toBe(1);
    expect(groups[0]!.key).toBe('tmdb:tv/1');
    expect(groups[0]!.releaseCount).toBe(6);
    expect(groups[0]!.peerCount).toBe(2);
    expect(
      groups[0]!.scopes.find((s) => s.scope === 'episode')!.units,
    ).toBe(6);
  });

  it('falls back to the info hash when a partner computed no signature', async () => {
    // Without a signature two partners' copies are different releases, because
    // nothing says otherwise. Claiming they are the same would be a guess.
    const a = await makePeer();
    const b = await makePeer();
    await mirror([{ peerId: a, name: 'Film.1080p-A', tmdbId: 'movie/2' }]);
    await mirror([{ peerId: b, name: 'Film.1080p-A', tmdbId: 'movie/2' }]);

    const { groups } = await listRemoteGroups(page);
    expect(groups[0]!.releaseCount).toBe(2);
    expect(groups[0]!.peerCount).toBe(2);
  });

  it('folds an untagged release across partners instead of splitting it', async () => {
    // A `solo:` key on the mirror holds a RELEASE key, not a row id — the same
    // untagged release on three partners is one group of one, not three.
    const peers = [await makePeer(), await makePeer(), await makePeer()];
    for (const peerId of peers) {
      await mirror([{ peerId, name: 'Orphan.Release-A', contentSignature: 'sig-o' }]);
    }

    const { groups, total } = await listRemoteGroups(page);
    expect(total).toBe(1);
    expect(groups[0]!.source).toBe('solo');
    expect(groups[0]!.releaseCount).toBe(1);
    expect(groups[0]!.peerCount).toBe(3);
  });

  it('reports how a series is cut, in units', async () => {
    const p = await makePeer();
    await mirror([
      { peerId: p, name: 'S01E01', contentSignature: 's1', tmdbId: 'tv/3', season: 1, episode: 1 },
      { peerId: p, name: 'S01E01.alt', contentSignature: 's2', tmdbId: 'tv/3', season: 1, episode: 1 },
      { peerId: p, name: 'S02E01', contentSignature: 's3', tmdbId: 'tv/3', season: 2, episode: 1 },
      { peerId: p, name: 'S01.COMPLETE', contentSignature: 's4', tmdbId: 'tv/3', season: 1 },
      { peerId: p, name: 'INTEGRALE', contentSignature: 's5', tmdbId: 'tv/3' },
    ]);

    const { groups } = await listRemoteGroups(page);
    const by = new Map(groups[0]!.scopes.map((s) => [s.scope, s.units]));
    // Two distinct (season, episode) pairs across three episode releases.
    expect(by.get('episode')).toBe(2);
    expect(by.get('season')).toBe(1);
    expect(by.get('integral')).toBe(1);
    expect(groups[0]!.releaseCount).toBe(5);
  });

  it('still shows a scope for a release the partner never dated', async () => {
    // `remote_created_at` is nullable and older feeds omitted it. A scope is
    // dropped when its latest date is null, so without the `fetched_at`
    // fallback such a release would silently lose the chip that says what the
    // group holds — and sort last forever.
    const p = await makePeer();
    await mirror([
      { peerId: p, name: 'Undated.Film-A', tmdbId: 'movie/4', remoteCreatedAt: null },
    ]);

    const { groups } = await listRemoteGroups(page);
    expect(groups[0]!.scopes.map((s) => s.scope)).toEqual(['all']);
    expect(groups[0]!.latest).toBeInstanceOf(Date);
  });

  it('hides a peer that is no longer active', async () => {
    // Suspending a peer does not purge its rows — only a hard delete does — so
    // the gate has to bite at read time.
    const live = await makePeer();
    const gone = await makePeer({ status: 'suspended' });
    await mirror([{ peerId: live, name: 'Kept', tmdbId: 'movie/5' }]);
    await mirror([{ peerId: gone, name: 'Hidden', tmdbId: 'movie/6' }]);

    const { groups } = await listRemoteGroups(page);
    expect(groups.map((g) => g.key)).toEqual(['tmdb:movie/5']);
  });

  it('honours the adult gate the origin mirrored to us', async () => {
    const p = await makePeer();
    await mirror([
      { peerId: p, name: 'Safe', tmdbId: 'movie/7' },
      { peerId: p, name: 'Adult', tmdbId: 'movie/8', isAdult: true },
    ]);

    const shown = await listRemoteGroups({ ...page, showAdult: false });
    expect(shown.groups.map((g) => g.key)).toEqual(['tmdb:movie/7']);

    const all = await listRemoteGroups({ ...page, showAdult: true });
    expect(all.groups).toHaveLength(2);
  });

  it('filters by scope, like the local listing', async () => {
    const p = await makePeer();
    await mirror([
      { peerId: p, name: 'A.S01E01', contentSignature: 'a', tmdbId: 'tv/9', season: 1, episode: 1 },
      { peerId: p, name: 'B.S01.COMPLETE', contentSignature: 'b', tmdbId: 'tv/10', season: 1 },
    ]);

    const packs = await listRemoteGroups({ ...page, scope: 'season' });
    expect(packs.groups.map((g) => g.key)).toEqual(['tmdb:tv/10']);
  });
});

describe('partnerReleaseCounts — the bridge', () => {
  it('counts distinct partner releases for a local group key', async () => {
    const a = await makePeer();
    const b = await makePeer();
    for (const peerId of [a, b]) {
      await mirror([
        { peerId, name: 'S04E01', contentSignature: 'x1', tmdbId: 'tv/11', season: 4, episode: 1 },
        { peerId, name: 'S04E02', contentSignature: 'x2', tmdbId: 'tv/11', season: 4, episode: 2 },
      ]);
    }
    await local('tv/11', 'Show.S01E01-A');

    const counts = await partnerReleaseCounts(['tmdb:tv/11'], true);
    // Four mirror rows, two releases.
    expect(counts.get('tmdb:tv/11')).toBe(2);
  });

  it('answers zero for a work no partner carries', async () => {
    await makePeer();
    const counts = await partnerReleaseCounts(['tmdb:tv/999'], true);
    expect(counts.get('tmdb:tv/999')).toBeUndefined();
  });

  it('matches each id namespace against its own column', async () => {
    const p = await makePeer();
    await mirror([
      { peerId: p, name: 'Game', igdbId: '1020' },
      { peerId: p, name: 'Book', openlibraryId: 'OL1M' },
      { peerId: p, name: 'Film', tmdbId: 'movie/12' },
    ]);

    const counts = await partnerReleaseCounts(
      ['igdb:1020', 'openlibrary:OL1M', 'tmdb:movie/12'],
      true,
    );
    expect(counts.get('igdb:1020')).toBe(1);
    expect(counts.get('openlibrary:OL1M')).toBe(1);
    expect(counts.get('tmdb:movie/12')).toBe(1);
  });

  it('skips keys with no external id rather than guessing', async () => {
    // An untagged local torrent cannot be matched to a partner by id, and
    // matching it by content signature is the "also available here" hint that
    // the federated view already renders. Asking for one must not scan.
    const p = await makePeer();
    await mirror([{ peerId: p, name: 'Whatever' }]);

    const counts = await partnerReleaseCounts(['solo:some-uuid'], true);
    expect(counts.size).toBe(0);
  });

  it('applies the same peer and adult gates as the listing', async () => {
    const gone = await makePeer({ status: 'blocked' });
    const live = await makePeer();
    await mirror([{ peerId: gone, name: 'From a blocked peer', tmdbId: 'tv/13' }]);
    await mirror([{ peerId: live, name: 'Adult', tmdbId: 'tv/14', isAdult: true }]);

    const counts = await partnerReleaseCounts(['tmdb:tv/13', 'tmdb:tv/14'], false);
    expect(counts.get('tmdb:tv/13')).toBeUndefined();
    expect(counts.get('tmdb:tv/14')).toBeUndefined();
  });

  it('reads the mirror through an index, not a scan', async () => {
    // The badge runs on every page of the local catalogue. Comparing the group
    // KEY expression to the list would be shorter to write and would scan every
    // partner's catalogue each time; matching one id namespace at a time is
    // what keeps it to an index lookup.
    const p = await makePeer();
    await mirror(
      Array.from({ length: 40 }, (_, i) => ({
        peerId: p,
        name: `Film ${i}`,
        tmdbId: `movie/${i}`,
      })),
    );

    const text = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const plan = await tx.execute<Record<string, string>>(sql`
        EXPLAIN SELECT 1 FROM remote_torrents WHERE tmdb_id IN ('movie/1', 'movie/2')`);
      return (plan as unknown as Array<Record<string, string>>)
        .map((r) => r['QUERY PLAN'])
        .join('\n');
    });
    expect(text).toContain('remote_torrents_tmdb_idx');
  });
});
