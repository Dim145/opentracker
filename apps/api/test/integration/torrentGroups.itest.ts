import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  groupMemberWhere,
  listGroups,
  parseGroupKey,
  scopeWhere,
  type GroupScope,
} from '../../utils/torrentGroups';
import { makeCategory } from './helpers';

// Server-side grouping, against a real Postgres.
//
// The unit tests cover `parseGroupKey` on its own. What can only be checked
// here is the agreement between what Postgres BUILDS — the group key and the
// scope, both CASE expressions — and what TypeScript takes apart again, because
// the two are written in different languages and nothing forces them to stay
// in step.
//
// The failure that agreement prevents is a quiet one: the listing keeps
// folding releases correctly, and every group link lands on an empty page. It
// reads as missing data, not as a bug — which is why the round trip is
// asserted here rather than assumed.

interface Row {
  name: string;
  size?: number;
  tmdbId?: string | null;
  igdbId?: string | null;
  openlibraryId?: string | null;
  season?: number | null;
  episode?: number | null;
  moderationStatus?: 'accepted' | 'pending' | 'rejected';
  isActive?: boolean;
  /** Snapshot swarm counts, for the group-level range. */
  seeders?: number;
  leechers?: number;
}

let categoryId: string;
let counter = 0;

async function seed(rows: Row[]): Promise<void> {
  const values = rows.map((r) => ({
    id: randomUUID(),
    infoHash: (counter++).toString(16).padStart(40, '0'),
    name: r.name,
    size: r.size ?? 1_000_000,
    tmdbId: r.tmdbId ?? null,
    igdbId: r.igdbId ?? null,
    openlibraryId: r.openlibraryId ?? null,
    season: r.season ?? null,
    episode: r.episode ?? null,
    categoryId,
    isActive: r.isActive ?? true,
    moderationStatus: r.moderationStatus ?? ('accepted' as const),
  }));
  await db.insert(schema.torrents).values(values);

  const stats = rows
    .map((r, i) => ({ r, hash: values[i]!.infoHash }))
    .filter(({ r }) => r.seeders != null || r.leechers != null)
    .map(({ r, hash }) => ({
      infoHash: hash,
      seeders: r.seeders ?? 0,
      leechers: r.leechers ?? 0,
    }));
  if (stats.length) await db.insert(schema.torrentStats).values(stats);
}

/** The releases one group actually holds, through the shipped predicate. */
async function membersOf(key: string, scope?: GroupScope): Promise<string[]> {
  const base = groupMemberWhere(parseGroupKey(key));
  const rows = await db
    .select({ name: schema.torrents.name })
    .from(schema.torrents)
    .where(scope ? scopeWhere(base, scope) : base);
  return rows.map((r) => r.name).sort();
}

beforeEach(async () => {
  categoryId = await makeCategory();
  counter = 0;
});

describe('listGroups', () => {
  it('folds every release of one film into a single group', async () => {
    await seed([
      { name: 'Some.Film.2011.2160p.UHD.BluRay.REMUX-A', tmdbId: 'movie/1', size: 60_000 },
      { name: 'Some.Film.2011.1080p.BluRay.x264-B', tmdbId: 'movie/1', size: 12_000 },
      { name: 'Some.Film.2011.720p.WEB-DL.x264-C', tmdbId: 'movie/1', size: 4_000 },
    ]);

    const { groups, total } = await listGroups({ limit: 25, offset: 0 });
    expect(total).toBe(1);
    expect(groups).toHaveLength(1);

    const [g] = groups;
    expect(g!.key).toBe('tmdb:movie/1');
    expect(g!.releaseCount).toBe(3);
    // The span, not a sum: adding the three up would describe downloading
    // every edition of one film, which nobody does.
    expect(g!.minSize).toBe(4_000);
    expect(g!.maxSize).toBe(60_000);
    // The heading is the largest release until metadata resolves.
    expect(g!.leadName).toContain('2160p');
    // A film is cut one way, so it advertises the single fallback scope.
    expect(g!.scopes.map((s) => s.scope)).toEqual(['all']);
    expect(g!.defaultScope).toBe('all');
  });

  it('keeps a whole series in ONE group and reports how it is cut', async () => {
    // The case the redesign exists for. Grouping on `(tmdb_id, season)` made a
    // three-season show three unrelated catalogue entries; a member looking for
    // a series wants the series, then chooses how deep to go.
    await seed([
      { name: 'Show.S01E01.1080p-A', tmdbId: 'tv/9', season: 1, episode: 1 },
      { name: 'Show.S01E02.1080p-A', tmdbId: 'tv/9', season: 1, episode: 2 },
      { name: 'Show.S02E01.1080p-A', tmdbId: 'tv/9', season: 2, episode: 1 },
      { name: 'Show.S01.COMPLETE.1080p-A', tmdbId: 'tv/9', season: 1 },
      { name: 'Show.INTEGRALE.1080p-A', tmdbId: 'tv/9' },
    ]);

    const { groups } = await listGroups({ limit: 25, offset: 0 });
    expect(groups).toHaveLength(1);

    const byScope = new Map(groups[0]!.scopes.map((s) => [s.scope, s.units]));
    // Units, not releases: three distinct (season, episode) pairs, one season
    // pack, one integral.
    expect(byScope.get('episode')).toBe(3);
    expect(byScope.get('season')).toBe(1);
    expect(byScope.get('integral')).toBe(1);
    expect(byScope.has('all')).toBe(false);
    expect(groups[0]!.releaseCount).toBe(5);
  });

  it('opens on the scope holding the newest release', async () => {
    await seed([
      { name: 'Show.S01E01.1080p-A', tmdbId: 'tv/10', season: 1, episode: 1 },
      { name: 'Show.INTEGRALE.1080p-A', tmdbId: 'tv/10' },
    ]);
    await db.execute(sql`UPDATE torrents
       SET created_at = '2024-01-01T00:00:00Z'::timestamptz
     WHERE episode IS NOT NULL`);
    await db.execute(sql`UPDATE torrents
       SET created_at = '2026-01-01T00:00:00Z'::timestamptz
     WHERE season IS NULL AND tmdb_id = 'tv/10'`);

    const first = await listGroups({ limit: 25, offset: 0 });
    expect(first.groups[0]!.defaultScope).toBe('integral');

    // Flip which side is newest; the default must follow, with no other input.
    await db.execute(sql`UPDATE torrents
       SET created_at = '2027-01-01T00:00:00Z'::timestamptz
     WHERE episode IS NOT NULL`);
    const second = await listGroups({ limit: 25, offset: 0 });
    expect(second.groups[0]!.defaultScope).toBe('episode');
  });

  it('files a series whose season could not be read as an integral', async () => {
    // A degraded answer, not a wrong one: an unreadable name lands in the one
    // scope that claims nothing about position.
    await seed([
      { name: 'Show.S01E01.1080p-A', tmdbId: 'tv/11', season: 1, episode: 1 },
      { name: 'Show.Unreadable.Name-A', tmdbId: 'tv/11' },
    ]);

    const { groups } = await listGroups({ limit: 25, offset: 0 });
    const byScope = new Map(groups[0]!.scopes.map((s) => [s.scope, s.units]));
    expect(byScope.get('integral')).toBe(1);
    expect(await membersOf('tmdb:tv/11', 'integral')).toEqual([
      'Show.Unreadable.Name-A',
    ]);
  });

  it('prefers a game or a book id over a stale TMDb id on the same row', async () => {
    await seed([
      { name: '[PS5] Game [EUR]', igdbId: '1020', tmdbId: 'movie/1' },
      { name: '[PC] Game [MULTI]', igdbId: '1020' },
      { name: 'Book.FR.[EPUB]', openlibraryId: 'OL1M', tmdbId: 'movie/1' },
    ]);

    const { groups } = await listGroups({ limit: 25, offset: 0 });
    expect(groups.map((g) => g.key).sort()).toEqual([
      'igdb:1020',
      'openlibrary:OL1M',
    ]);
    expect(groups.find((g) => g.key === 'igdb:1020')!.releaseCount).toBe(2);
  });

  it('gives an untagged torrent a group of its own', async () => {
    await seed([{ name: 'Orphan.Release-A' }, { name: 'Orphan.Release-B' }]);

    const { groups, total } = await listGroups({ limit: 25, offset: 0 });
    expect(total).toBe(2);
    expect(groups.every((g) => g.source === 'solo')).toBe(true);
    expect(groups.every((g) => g.releaseCount === 1)).toBe(true);
    expect(groups.every((g) => g.defaultScope === 'all')).toBe(true);
  });

  it('never shows a release the catalogue is hiding', async () => {
    await seed([
      { name: 'Film.1080p-A', tmdbId: 'movie/2' },
      { name: 'Film.2160p-B', tmdbId: 'movie/2', moderationStatus: 'pending' },
      { name: 'Film.720p-C', tmdbId: 'movie/2', isActive: false },
    ]);

    const { groups } = await listGroups({ limit: 25, offset: 0 });
    // The count is what the rest of the site agrees with — one, not three.
    expect(groups[0]!.releaseCount).toBe(1);
  });

  it('reports the swarm as a range over the snapshot', async () => {
    // Not a sum, and not from Redis: one live read per release would be
    // hundreds of round trips for a page of long-running series.
    await seed([
      { name: 'Film.2160p-A', tmdbId: 'movie/12', seeders: 92, leechers: 1 },
      { name: 'Film.1080p-B', tmdbId: 'movie/12', seeders: 7, leechers: 0 },
    ]);

    const { groups } = await listGroups({ limit: 25, offset: 0 });
    expect(groups[0]!.seedMin).toBe(7);
    expect(groups[0]!.seedMax).toBe(92);
    expect(groups[0]!.leechMin).toBe(0);
    expect(groups[0]!.leechMax).toBe(1);
  });

  it('reads a release with no snapshot row as zero, not as absent', async () => {
    await seed([{ name: 'Film.1080p-A', tmdbId: 'movie/13' }]);
    const { groups } = await listGroups({ limit: 25, offset: 0 });
    expect(groups[0]!.seedMin).toBe(0);
    expect(groups[0]!.seedMax).toBe(0);
  });

  it('filters the listing by scope', async () => {
    // The filter no search term expresses: "show me the season packs" is a
    // question about how a release is cut.
    await seed([
      { name: 'A.S01E01-A', tmdbId: 'tv/14', season: 1, episode: 1 },
      { name: 'B.S01.COMPLETE-A', tmdbId: 'tv/15', season: 1 },
      { name: 'Orphan-A' },
    ]);

    const packs = await listGroups({ limit: 25, offset: 0, scope: 'season' });
    expect(packs.groups.map((g) => g.key)).toEqual(['tmdb:tv/15']);
    expect(packs.total).toBe(1);

    const eps = await listGroups({ limit: 25, offset: 0, scope: 'episode' });
    expect(eps.groups.map((g) => g.key)).toEqual(['tmdb:tv/14']);

    // An untagged torrent is a group of one and carries the fallback scope, so
    // it survives `all` and nothing else.
    const flat = await listGroups({ limit: 25, offset: 0, scope: 'all' });
    expect(flat.groups.map((g) => g.source)).toEqual(['solo']);
  });

  it('orders groups by their newest release and paginates over both halves', async () => {
    await seed([
      { name: 'Old.Film.1080p-A', tmdbId: 'movie/3' },
      { name: 'Orphan.Release-Z' },
    ]);
    // Bound as text and cast: postgres.js will not bind a JS `Date` through a
    // raw statement, and the driver's own timestamp handling is not what this
    // test is about.
    await db.execute(sql`UPDATE torrents
       SET created_at = '2024-01-01T00:00:00Z'::timestamptz
     WHERE tmdb_id = 'movie/3'`);
    await db.execute(sql`UPDATE torrents
       SET created_at = '2026-01-01T00:00:00Z'::timestamptz
     WHERE tmdb_id IS NULL`);

    const { groups, total } = await listGroups({ limit: 1, offset: 0 });
    expect(total).toBe(2);
    // A tagged group does not outrank a fresher untagged one: the two halves
    // of the query are merged on recency, not concatenated.
    expect(groups[0]!.source).toBe('solo');

    const second = await listGroups({ limit: 1, offset: 1 });
    expect(second.groups[0]!.key).toBe('tmdb:movie/3');
  });
});

describe('the key round trip', () => {
  it('every key the listing emits finds its own releases again', async () => {
    // The whole point of this file. Each shape is built by SQL and taken apart
    // by TypeScript; the assertion is that the two agree on all of them.
    await seed([
      { name: 'Film.2160p-A', tmdbId: 'movie/4' },
      { name: 'Film.1080p-B', tmdbId: 'movie/4' },
      { name: 'Show.S03E01-A', tmdbId: 'tv/5', season: 3, episode: 1 },
      { name: 'Show.S03E02-A', tmdbId: 'tv/5', season: 3, episode: 2 },
      { name: 'Show.S03.COMPLETE-A', tmdbId: 'tv/5', season: 3 },
      { name: 'Show.Unreadable-A', tmdbId: 'tv/5' },
      { name: '[PS5] Game [EUR]', igdbId: '77' },
      { name: 'Book.[EPUB]', openlibraryId: 'OL9M' },
      { name: 'Orphan-A' },
    ]);

    const { groups } = await listGroups({ limit: 50, offset: 0 });
    expect(groups).toHaveLength(5);

    for (const g of groups) {
      const members = await membersOf(g.key);
      expect(
        members,
        `key ${g.key} should resolve to ${g.releaseCount} release(s)`,
      ).toHaveLength(g.releaseCount);
    }
  });

  it('every scope a group advertises resolves to that many units', async () => {
    // The second half of the agreement: `scopeSql` decides what a group SAYS
    // it holds, `scopeWhere` decides what it HANDS BACK, and they are written
    // against different things — a CASE expression and the plain columns.
    await seed([
      { name: 'Show.S01E01-A', tmdbId: 'tv/6', season: 1, episode: 1 },
      { name: 'Show.S01E01-B', tmdbId: 'tv/6', season: 1, episode: 1 },
      { name: 'Show.S02E05-A', tmdbId: 'tv/6', season: 2, episode: 5 },
      { name: 'Show.S01.COMPLETE-A', tmdbId: 'tv/6', season: 1 },
      { name: 'Show.S02.COMPLETE-A', tmdbId: 'tv/6', season: 2 },
      { name: 'Show.INTEGRALE-A', tmdbId: 'tv/6' },
    ]);

    const { groups } = await listGroups({ limit: 25, offset: 0 });
    const g = groups[0]!;

    // Two distinct episodes across three episode releases.
    expect(g.scopes.find((s) => s.scope === 'episode')!.units).toBe(2);
    expect(await membersOf(g.key, 'episode')).toEqual([
      'Show.S01E01-A',
      'Show.S01E01-B',
      'Show.S02E05-A',
    ]);

    expect(g.scopes.find((s) => s.scope === 'season')!.units).toBe(2);
    expect(await membersOf(g.key, 'season')).toEqual([
      'Show.S01.COMPLETE-A',
      'Show.S02.COMPLETE-A',
    ]);

    expect(g.scopes.find((s) => s.scope === 'integral')!.units).toBe(1);
    expect(await membersOf(g.key, 'integral')).toEqual(['Show.INTEGRALE-A']);
  });

  it('a book key ignores a row that also carries a game id', async () => {
    // Mirrors the precedence in `groupKeySql`: a row with both belongs to the
    // game group, so the book predicate must exclude it or the two groups
    // would each claim the same release.
    await seed([
      { name: 'Both.Ids-A', igdbId: '88', openlibraryId: 'OL8M' },
      { name: 'Book.Only-B', openlibraryId: 'OL8M' },
    ]);

    expect(await membersOf('openlibrary:OL8M')).toEqual(['Book.Only-B']);
    expect(await membersOf('igdb:88')).toEqual(['Both.Ids-A']);
  });

  it('a key nobody produced resolves to nothing rather than to everything', async () => {
    await seed([{ name: 'Film.1080p-A', tmdbId: 'movie/7' }]);

    for (const key of ['', 'nonsense', 'tmdb:', '::::']) {
      expect(await membersOf(key), `key ${JSON.stringify(key)}`).toEqual([]);
    }
  });
});

describe('the split query', () => {
  it('the untagged half is covered by an index rather than aggregated', async () => {
    // The reason the query is in two halves. A torrent with no external id is
    // a group of one and needs no aggregation, so that half streams off
    // `torrents_ungrouped_idx` and stops at the limit — sub-millisecond
    // against 180 ms for a `GROUP BY` over the whole table.
    //
    // On the handful of rows a test can seed, a sequential scan is genuinely
    // cheaper and the planner is right to choose it, so the assertion is not
    // "the index is used" but "the index CAN serve this shape": with the
    // sequential path taken away, the plan must fall on that index and must
    // not need a sort. Lose the index, or let the predicate drift away from
    // its WHERE clause, and this fails. Nothing else would — the page would
    // simply go quadratic in production.
    await seed(
      Array.from({ length: 60 }, (_, i) => ({ name: `Orphan.${i}-A` })),
    );

    const text = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`);
      const plan = await tx.execute<Record<string, string>>(sql`
        EXPLAIN SELECT coalesce(${schema.torrents.moderatedAt}, ${schema.torrents.createdAt}) AS latest
          FROM ${schema.torrents}
         WHERE ${and(
           sql`${schema.torrents.moderationStatus} = 'accepted'`,
           sql`${schema.torrents.isActive}`,
           sql`${schema.torrents.tmdbId} IS NULL`,
           sql`${schema.torrents.igdbId} IS NULL`,
           sql`${schema.torrents.openlibraryId} IS NULL`,
         )}
         ORDER BY latest DESC
         LIMIT 25`);
      return (plan as unknown as Array<Record<string, string>>)
        .map((r) => r['QUERY PLAN'])
        .join('\n');
    });

    expect(text).toContain('torrents_ungrouped_idx');
    // Ordering comes from the index itself. A `Sort` here would mean the page
    // reads every untagged row before it can return twenty-five.
    expect(text).not.toContain('Sort');
  });
});
