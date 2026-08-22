import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  listMixedGroups,
  mixedBuckets,
  mixedGroupHeader,
  mixedReleases,
} from '../../utils/mixedGroups';
import {
  groupMemberWhere,
  parseGroupKey,
  scopeWhere,
} from '../../utils/torrentGroups';
import { remoteGroupMemberWhere } from '../../utils/remoteGroups';
import { makeCategory } from './helpers';

// Two catalogues folded into one listing.
//
// Everything here turns on one number being right: how many RELEASES a group
// holds. Two independent things can inflate it, and both look like success
// rather than like a bug:
//
//   1. The same release counted once per partner that mirrors it. A season on
//      four partners becomes four seasons — a catalogue that looks wonderfully
//      well stocked and is a quarter of its claimed size.
//   2. Our own copy counted separately from the partners' copy of the same
//      file. The member sees the release twice and cannot tell which one is
//      theirs.
//
// So almost every assertion below is a count, and the interesting fixtures are
// the ones where the same file exists in both places.

let categoryId: string;
let counter = 0;

async function makePeer(name = 'Partner'): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    displayName: name,
    status: 'active',
    sharesWithThem: { catalog: true, social: false, accounts: false, swarm: false },
    acceptsFromThem: { catalog: true, social: false, accounts: false, swarm: false },
  });
  return id;
}

interface LocalRow {
  name: string;
  size?: number;
  contentSignature?: string | null;
  infoHash?: string;
  tmdbId?: string | null;
  igdbId?: string | null;
  season?: number | null;
  episode?: number | null;
  seeders?: number;
  moderationStatus?: 'accepted' | 'pending';
}

async function local(rows: LocalRow[]): Promise<void> {
  const values = rows.map((r) => ({
    id: randomUUID(),
    infoHash: r.infoHash ?? (counter++).toString(16).padStart(40, 'a'),
    name: r.name,
    size: r.size ?? 1_000_000,
    contentSignature: r.contentSignature ?? null,
    tmdbId: r.tmdbId ?? null,
    igdbId: r.igdbId ?? null,
    season: r.season ?? null,
    episode: r.episode ?? null,
    categoryId,
    moderationStatus: r.moderationStatus ?? ('accepted' as const),
    isActive: true,
  }));
  await db.insert(schema.torrents).values(values);
  const stats = rows
    .map((r, i) => ({ r, hash: values[i]!.infoHash }))
    .filter(({ r }) => r.seeders != null)
    .map(({ r, hash }) => ({ infoHash: hash, seeders: r.seeders!, leechers: 0 }));
  if (stats.length) await db.insert(schema.torrentStats).values(stats);
}

interface MirrorRow {
  peerId: string;
  name: string;
  size?: number;
  contentSignature?: string | null;
  infoHash?: string;
  tmdbId?: string | null;
  igdbId?: string | null;
  season?: number | null;
  episode?: number | null;
  seeders?: number;
  isAdult?: boolean;
  categorySlug?: string | null;
}

async function mirror(rows: MirrorRow[]): Promise<void> {
  await db.insert(schema.remoteTorrents).values(
    rows.map((r) => ({
      id: randomUUID(),
      peerId: r.peerId,
      remoteId: `sha256:${randomUUID().replace(/-/g, '')}`,
      infoHash: r.infoHash ?? (counter++).toString(16).padStart(40, 'b'),
      contentSignature: r.contentSignature ?? null,
      name: r.name,
      size: r.size ?? 1_000_000,
      tmdbId: r.tmdbId ?? null,
      igdbId: r.igdbId ?? null,
      season: r.season ?? null,
      episode: r.episode ?? null,
      seeders: r.seeders ?? 0,
      leechers: 0,
      isAdult: r.isAdult ?? false,
      categorySlug: r.categorySlug ?? 'movies',
      remoteDetailUrl: `https://origin.example/t/${counter}`,
      remoteCreatedAt: new Date(),
    })),
  );
}

const page = { limit: 25, offset: 0 };

/** The header + releases of one group, through the shipped predicates. */
async function detail(key: string, localOnly = false) {
  const parsed = parseGroupKey(key);
  const base = groupMemberWhere(parsed);
  const remote = remoteGroupMemberWhere(parsed);
  return {
    header: await mixedGroupHeader(base, remote, localOnly),
    ...(await mixedReleases(base, remote, localOnly, 100)),
  };
}

beforeEach(async () => {
  counter = 0;
  categoryId = await makeCategory();
});

describe('one release, several places', () => {
  it('counts a release we share with a partner once', async () => {
    const p = await makePeer();
    await local([{ name: 'Film.2024.1080p', tmdbId: 'movie/1', contentSignature: 'sig-a' }]);
    await mirror([
      { peerId: p, name: 'Film.2024.1080p', tmdbId: 'movie/1', contentSignature: 'sig-a' },
    ]);

    const { groups } = await listMixedGroups(page);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.releaseCount).toBe(1);
    // Both halves claim it, which is how the row can say "you have this, and
    // so do they" without counting it twice.
    expect(groups[0]!.localCount).toBe(1);
    expect(groups[0]!.partnerCount).toBe(1);
  });

  it('counts a release only a partner has', async () => {
    const p = await makePeer();
    await local([{ name: 'Film.2024.1080p', tmdbId: 'movie/1', contentSignature: 'sig-a' }]);
    await mirror([
      { peerId: p, name: 'Film.2024.2160p', tmdbId: 'movie/1', contentSignature: 'sig-b' },
    ]);

    const { groups } = await listMixedGroups(page);

    expect(groups[0]!.releaseCount).toBe(2);
    expect(groups[0]!.localCount).toBe(1);
    expect(groups[0]!.partnerCount).toBe(1);
  });

  it('does not multiply a release by the number of partners holding it', async () => {
    // The failure this file exists for. Four partners with the same file is
    // one release, not four.
    const peers = await Promise.all([
      makePeer('A'), makePeer('B'), makePeer('C'), makePeer('D'),
    ]);
    await mirror(
      peers.map((peerId) => ({
        peerId,
        name: 'Show.S01E01.1080p',
        tmdbId: 'tv/9',
        contentSignature: 'sig-ep1',
        season: 1,
        episode: 1,
      })),
    );

    const { groups } = await listMixedGroups(page);

    expect(groups[0]!.releaseCount).toBe(1);
    expect(groups[0]!.peerCount).toBe(4);
  });

  it('falls back to the info hash when nobody computed a signature', async () => {
    const p = await makePeer();
    const hash = 'd'.repeat(40);
    await local([{ name: 'Film.2024', tmdbId: 'movie/1', infoHash: hash }]);
    await mirror([{ peerId: p, name: 'Film.2024', tmdbId: 'movie/1', infoHash: hash }]);

    const { groups } = await listMixedGroups(page);

    expect(groups[0]!.releaseCount).toBe(1);
  });

  it('refuses to fold on the backfill\'s empty-string sentinel', async () => {
    // `content_signature = ''` means "this blob could not be parsed", written
    // once so the backfill stops retrying. Treating it as a value would fold
    // every unparseable torrent in the catalogue into a single release.
    await local([
      { name: 'Alpha.2024', tmdbId: 'movie/1', contentSignature: '' },
      { name: 'Beta.2024', tmdbId: 'movie/1', contentSignature: '' },
    ]);

    const { groups } = await listMixedGroups(page);

    expect(groups[0]!.releaseCount).toBe(2);
  });
});

describe('the listing', () => {
  it('holds one row for a work both catalogues carry', async () => {
    const p = await makePeer();
    await local([{ name: 'Show.S01E01', tmdbId: 'tv/1', season: 1, episode: 1 }]);
    await mirror([
      { peerId: p, name: 'Show.S02E01', tmdbId: 'tv/1', season: 2, episode: 1 },
    ]);

    const { groups, total } = await listMixedGroups(page);

    expect(total).toBe(1);
    expect(groups[0]!.key).toBe('tmdb:tv/1');
    expect(groups[0]!.releaseCount).toBe(2);
  });

  it('advertises a scope only a partner supplies', async () => {
    // The question the badge could never answer: they have the season pack,
    // and now it is a chip on our own row.
    const p = await makePeer();
    await local([{ name: 'Show.S01E01', tmdbId: 'tv/1', season: 1, episode: 1 }]);
    await mirror([
      { peerId: p, name: 'Show.S01.COMPLETE', tmdbId: 'tv/1', season: 1, episode: null },
    ]);

    const { groups } = await listMixedGroups(page);

    const scopes = groups[0]!.scopes.map((s) => s.scope).sort();
    expect(scopes).toEqual(['episode', 'season']);
    expect(groups[0]!.scopes.find((s) => s.scope === 'season')!.units).toBe(1);
  });

  it('counts episodes, not copies of episodes', async () => {
    const a = await makePeer('A');
    const b = await makePeer('B');
    await local([
      { name: 'Show.S01E01', tmdbId: 'tv/1', season: 1, episode: 1, contentSignature: 's1' },
      { name: 'Show.S01E02', tmdbId: 'tv/1', season: 1, episode: 2, contentSignature: 's2' },
    ]);
    await mirror([
      { peerId: a, name: 'Show.S01E01', tmdbId: 'tv/1', season: 1, episode: 1, contentSignature: 's1' },
      { peerId: b, name: 'Show.S01E01', tmdbId: 'tv/1', season: 1, episode: 1, contentSignature: 's1' },
      { peerId: a, name: 'Show.S01E03', tmdbId: 'tv/1', season: 1, episode: 3, contentSignature: 's3' },
    ]);

    const { groups } = await listMixedGroups(page);

    expect(groups[0]!.scopes.find((s) => s.scope === 'episode')!.units).toBe(3);
    expect(groups[0]!.releaseCount).toBe(3);
  });

  it('leaves the mirror out when asked for our catalogue only', async () => {
    const p = await makePeer();
    await local([{ name: 'Ours', tmdbId: 'movie/1' }]);
    await mirror([{ peerId: p, name: 'Theirs', tmdbId: 'movie/2' }]);

    const { groups, total } = await listMixedGroups({ ...page, localOnly: true });

    expect(total).toBe(1);
    expect(groups[0]!.key).toBe('tmdb:movie/1');
  });

  it('ignores a suspended partner without purging its rows', async () => {
    const p = await makePeer();
    await mirror([{ peerId: p, name: 'Theirs', tmdbId: 'movie/2' }]);
    await db
      .update(schema.federationPeers)
      .set({ status: 'suspended' })
      .where(sql`${schema.federationPeers.id} = ${p}`);

    const { groups } = await listMixedGroups(page);

    expect(groups).toHaveLength(0);
  });

  it('never surfaces a release the local catalogue is hiding', async () => {
    await local([
      { name: 'Pending', tmdbId: 'movie/1', moderationStatus: 'pending' },
      { name: 'Accepted', tmdbId: 'movie/1' },
    ]);

    const { groups } = await listMixedGroups(page);

    expect(groups[0]!.releaseCount).toBe(1);
    expect(groups[0]!.localCount).toBe(1);
  });

  it('folds an untagged release with its mirrored copy', async () => {
    const p = await makePeer();
    await local([{ name: 'Unidentified.Thing', contentSignature: 'sig-u' }]);
    await mirror([{ peerId: p, name: 'Unidentified.Thing', contentSignature: 'sig-u' }]);

    const { groups, total } = await listMixedGroups(page);

    expect(total).toBe(1);
    expect(groups[0]!.key).toBe('solo:sig-u');
    expect(groups[0]!.releaseCount).toBe(1);
    expect(groups[0]!.localCount).toBe(1);
    expect(groups[0]!.partnerCount).toBe(1);
  });

  it('orders by the newest release across both catalogues', async () => {
    const p = await makePeer();
    await local([{ name: 'Old', tmdbId: 'movie/1' }]);
    await db
      .update(schema.torrents)
      .set({ createdAt: new Date('2020-01-01T00:00:00Z') });
    await mirror([{ peerId: p, name: 'New', tmdbId: 'movie/2' }]);

    const { groups } = await listMixedGroups(page);

    expect(groups.map((g) => g.key)).toEqual(['tmdb:movie/2', 'tmdb:movie/1']);
  });

  it('paginates over both halves at once', async () => {
    const p = await makePeer();
    await local(
      Array.from({ length: 3 }, (_, i) => ({ name: `L${i}`, tmdbId: `movie/l${i}` })),
    );
    await mirror(
      Array.from({ length: 3 }, (_, i) => ({
        peerId: p,
        name: `R${i}`,
        tmdbId: `movie/r${i}`,
      })),
    );

    const first = await listMixedGroups({ limit: 4, offset: 0 });
    const second = await listMixedGroups({ limit: 4, offset: 4 });

    expect(first.total).toBe(6);
    expect(first.groups).toHaveLength(4);
    expect(second.groups).toHaveLength(2);
    const keys = [...first.groups, ...second.groups].map((g) => g.key);
    expect(new Set(keys).size).toBe(6);
  });
});

describe('one group, in detail', () => {
  it('lists a shared release once, with both places to get it', async () => {
    const p = await makePeer('Partner One');
    await local([
      { name: 'Film.2024.1080p', tmdbId: 'movie/1', contentSignature: 'sig-a', seeders: 5 },
    ]);
    await mirror([
      {
        peerId: p,
        name: 'Film.2024.1080p',
        tmdbId: 'movie/1',
        contentSignature: 'sig-a',
        seeders: 40,
      },
    ]);

    const { header, releases } = await detail('tmdb:movie/1');

    expect(header.releaseCount).toBe(1);
    expect(releases).toHaveLength(1);
    expect(releases[0]!.sources).toHaveLength(2);
    // Ours first: it is the copy that can carry a download button.
    expect(releases[0]!.sources[0]!.kind).toBe('local');
    expect(releases[0]!.torrentId).toBeTruthy();
    expect(releases[0]!.sources[1]!.peerName).toBe('Partner One');
    // The best swarm across the sources — the number that decides which to grab.
    expect(releases[0]!.seeders).toBe(40);
  });

  it('marks a release we do not hold as having no local source', async () => {
    const p = await makePeer();
    await mirror([
      { peerId: p, name: 'Only.Theirs', tmdbId: 'movie/1', contentSignature: 'sig-x' },
    ]);

    const { releases } = await detail('tmdb:movie/1');

    expect(releases[0]!.torrentId).toBeNull();
    expect(releases[0]!.sources.map((s) => s.kind)).toEqual(['partner']);
    expect(releases[0]!.sources[0]!.url).toMatch(/^https:\/\/origin\.example\//);
  });

  it('takes the release location from the row, not from the partner\'s address', async () => {
    // A record says where its content lives. Once records are relayed, the
    // partner that handed it over is not necessarily that place.
    const p = await makePeer();
    await mirror([{ peerId: p, name: 'Relayed', tmdbId: 'movie/1' }]);

    const { releases } = await detail('tmdb:movie/1');

    expect(releases[0]!.sources[0]!.url).not.toContain('p-');
  });

  it('counts a season header by releases, not by mirror rows', async () => {
    const a = await makePeer('A');
    const b = await makePeer('B');
    await local([
      { name: 'Show.S01E01', tmdbId: 'tv/1', season: 1, episode: 1, contentSignature: 's1' },
    ]);
    await mirror([
      { peerId: a, name: 'Show.S01E01', tmdbId: 'tv/1', season: 1, episode: 1, contentSignature: 's1' },
      { peerId: b, name: 'Show.S01E01', tmdbId: 'tv/1', season: 1, episode: 1, contentSignature: 's1' },
      { peerId: a, name: 'Show.S01E02', tmdbId: 'tv/1', season: 1, episode: 2, contentSignature: 's2' },
    ]);

    const parsed = parseGroupKey('tmdb:tv/1');
    const seasons = await mixedBuckets(
      scopeWhere(groupMemberWhere(parsed), 'episode'),
      sql`${remoteGroupMemberWhere(parsed)} AND ${schema.remoteTorrents.season} IS NOT NULL
          AND ${schema.remoteTorrents.episode} IS NOT NULL`,
      false,
      'season',
    );

    expect(seasons).toHaveLength(1);
    expect(seasons[0]!.season).toBe(1);
    expect(seasons[0]!.releaseCount).toBe(2);
    expect(seasons[0]!.episodeCount).toBe(2);
  });

  it('holds the same totals when the mirror is left out', async () => {
    const p = await makePeer();
    await local([{ name: 'Ours', tmdbId: 'movie/1', contentSignature: 'sig-a' }]);
    await mirror([
      { peerId: p, name: 'Theirs', tmdbId: 'movie/1', contentSignature: 'sig-b' },
    ]);

    const merged = await detail('tmdb:movie/1');
    const alone = await detail('tmdb:movie/1', true);

    expect(merged.header.releaseCount).toBe(2);
    expect(alone.header.releaseCount).toBe(1);
    expect(alone.releases).toHaveLength(1);
    expect(alone.releases[0]!.sources.map((s) => s.kind)).toEqual(['local']);
  });
});

describe('the total', () => {
  it('counts every untagged group, not just the page-sized window', async () => {
    // The untagged half is windowed before it is folded, so a page can stream
    // off an index instead of folding the whole catalogue. Counting through
    // that window would report the window size — the pager would collapse to
    // one page and the rest of the catalogue would be unreachable, silently.
    await local(
      Array.from({ length: 12 }, (_, i) => ({ name: `Orphan.${i}` })),
    );

    const { groups, total } = await listMixedGroups({ limit: 5, offset: 0 });

    expect(groups).toHaveLength(5);
    expect(total).toBe(12);
  });

  it('counts a folded pair once on both sides of the window', async () => {
    const p = await makePeer();
    await local([{ name: 'Shared.Orphan', contentSignature: 'sig-s' }]);
    await mirror([{ peerId: p, name: 'Shared.Orphan', contentSignature: 'sig-s' }]);
    await local([{ name: 'Ours.Alone', contentSignature: 'sig-o' }]);

    const { total } = await listMixedGroups({ limit: 25, offset: 0 });

    expect(total).toBe(2);
  });
});

describe('local moderation of federated content (masks)', () => {
  it('hides a masked release from the grouped listing, and shows it again when lifted', async () => {
    const { maskRemote, unmaskRemote } = await import('../../utils/federation/remoteMask');
    const peer = await makePeer();
    const hash = 'dddd0000dddd0000dddd0000dddd0000dddd0000';
    await mirror([{ peerId: peer, name: 'Bad.Release.1080p', tmdbId: 'tv/424242', infoHash: hash }]);

    // Visible before.
    const before = await listMixedGroups(page);
    expect(before.groups.some((g) => g.leadName === 'Bad.Release.1080p')).toBe(true);

    const id = await maskRemote('infohash', hash, { reason: 'illegal' });

    // Gone from the merged listing after masking — the peer is untouched.
    const masked = await listMixedGroups(page);
    expect(masked.groups.some((g) => g.leadName === 'Bad.Release.1080p')).toBe(false);

    // And back when the mask is lifted.
    expect(await unmaskRemote(id)).toBe(true);
    const after = await listMixedGroups(page);
    expect(after.groups.some((g) => g.leadName === 'Bad.Release.1080p')).toBe(true);
  });

  it('mutes every release from one author DID at once', async () => {
    const { maskRemote } = await import('../../utils/federation/remoteMask');
    const peer = await makePeer();
    const did = 'did:key:zBadUploader';
    await db.insert(schema.remoteTorrents).values([
      { id: randomUUID(), peerId: peer, remoteId: `sha256:${randomUUID().replace(/-/g, '')}`, infoHash: 'aa'.repeat(20), name: 'A.1080p', tmdbId: 'tv/700', authorDid: did, size: 1, seeders: 0, leechers: 0, isAdult: false, categorySlug: 'movies', remoteCreatedAt: new Date() },
      { id: randomUUID(), peerId: peer, remoteId: `sha256:${randomUUID().replace(/-/g, '')}`, infoHash: 'bb'.repeat(20), name: 'B.1080p', tmdbId: 'tv/701', authorDid: did, size: 1, seeders: 0, leechers: 0, isAdult: false, categorySlug: 'movies', remoteCreatedAt: new Date() },
    ]);

    await maskRemote('author', did);

    const listed = await listMixedGroups(page);
    expect(listed.groups.some((g) => g.leadName === 'A.1080p')).toBe(false);
    expect(listed.groups.some((g) => g.leadName === 'B.1080p')).toBe(false);
  });

  it('is idempotent on the same (scope, value)', async () => {
    const { maskRemote } = await import('../../utils/federation/remoteMask');
    const a = await maskRemote('infohash', 'cc'.repeat(20));
    const b = await maskRemote('infohash', 'cc'.repeat(20));
    expect(a).toBe(b);
  });
});

// A partner files releases under its own category vocabulary. When the slug is
// not one we share, the release falls out of every local category unless an
// operator maps the foreign slug onto one of ours. `makeCategory` gives the
// local category a random slug, so 'films' never matches by convention — the
// mapping is the only thing that can bridge it.
describe('federated taxonomy mapping', () => {
  it('brings a foreign-slug release into a local category once mapped', async () => {
    const { remoteCategoryFilter, setRemoteCategoryMapping } = await import(
      '../../utils/federation/categoryMap'
    );
    const peer = await makePeer();
    await mirror([
      { peerId: peer, name: 'Foreign.Slug.1080p', tmdbId: 'tv/999', categorySlug: 'films' },
    ]);

    // The mapping predicate alone catches nothing before the mapping exists.
    const before = await listMixedGroups({
      ...page,
      remoteWhere: remoteCategoryFilter([categoryId]),
    });
    expect(before.groups.some((g) => g.leadName === 'Foreign.Slug.1080p')).toBe(false);

    await setRemoteCategoryMapping('films', categoryId);

    const after = await listMixedGroups({
      ...page,
      remoteWhere: remoteCategoryFilter([categoryId]),
    });
    expect(after.groups.some((g) => g.leadName === 'Foreign.Slug.1080p')).toBe(true);
  });

  it('resolves mapped slugs to the local category and omits unmapped ones', async () => {
    const { resolveRemoteSlugs, setRemoteCategoryMapping } = await import(
      '../../utils/federation/categoryMap'
    );
    await setRemoteCategoryMapping('films', categoryId);
    const resolved = await resolveRemoteSlugs(['films', 'never-seen']);
    expect(resolved.get('films')?.categoryId).toBe(categoryId);
    expect(resolved.get('films')?.name).toBe('Movies');
    expect(resolved.has('never-seen')).toBe(false);
  });

  it('re-points a slug in place instead of forking it', async () => {
    const { resolveRemoteSlugs, setRemoteCategoryMapping } = await import(
      '../../utils/federation/categoryMap'
    );
    const other = await makeCategory();
    await setRemoteCategoryMapping('films', categoryId);
    await setRemoteCategoryMapping('films', other);

    const resolved = await resolveRemoteSlugs(['films']);
    expect(resolved.get('films')?.categoryId).toBe(other);

    // The unique index on the slug held: one row, re-pointed, never duplicated.
    const rows = await db
      .select()
      .from(schema.remoteCategoryMap)
      .where(eq(schema.remoteCategoryMap.remoteSlug, 'films'));
    expect(rows.length).toBe(1);
  });
});
