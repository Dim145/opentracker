import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, or, sql, type SQL } from 'drizzle-orm';
import { db, schema, ftsVector } from '@trackarr/db';
import { toPrefixTsQuery, FTS_CONFIG } from '../../utils/search';
import { makeCategory } from './helpers';

// Full-text search, against a real Postgres.
//
// The helpers are covered by unit tests; what can only be checked here is the
// agreement between the *indexed* expression and the *queried* expression. An
// expression index only serves the query when the two are identical: if they
// diverge, nothing breaks — search keeps returning the right results, by
// scanning the table sequentially. The defect is therefore invisible to a
// functional test and shows up only in the execution plan. Hence the test that
// reads `EXPLAIN`.

interface Row {
  name: string;
  description?: string | null;
  nfo?: string | null;
}

let categoryId: string;

async function seed(rows: Row[]): Promise<void> {
  await db.insert(schema.torrents).values(
    rows.map((r, i) => ({
      id: randomUUID(),
      infoHash: i.toString(16).padStart(40, '0'),
      name: r.name,
      size: 1_000_000 + i,
      description: r.description ?? null,
      nfo: r.nfo ?? null,
      categoryId,
      moderationStatus: 'accepted' as const,
    })),
  );
  await db.execute(sql`ANALYZE torrents`);
}

/** Reproduces the route's predicate for the requested fields. */
function searchCondition(term: string, fields: string[]): SQL {
  const tsq = toPrefixTsQuery(term)!;
  const q = sql`to_tsquery(${FTS_CONFIG}, ${tsq})`;
  const branches: SQL[] = [];
  if (fields.includes('name')) {
    branches.push(sql`${ftsVector(schema.torrents.name)} @@ ${q}`);
  }
  if (fields.includes('description')) {
    branches.push(sql`${ftsVector(schema.torrents.description)} @@ ${q}`);
  }
  if (fields.includes('nfo')) {
    branches.push(sql`${ftsVector(schema.torrents.nfo)} @@ ${q}`);
  }
  return branches.length > 1 ? or(...branches)! : branches[0]!;
}

async function find(term: string, fields: string[]): Promise<string[]> {
  const rows = await db
    .select({ name: schema.torrents.name })
    .from(schema.torrents)
    .where(searchCondition(term, fields));
  return rows.map((r) => r.name).sort();
}

beforeEach(async () => {
  categoryId = await makeCategory();
});

describe('full-text search — field scope', () => {
  beforeEach(async () => {
    await seed([
      { name: 'Crimson Vault 1994 1080p BluRay x264-NTb', description: 'A thriller.' },
      { name: 'Northern Lights 2011 2160p WEB-DL x265', description: 'Contains crimson in the text.' },
      { name: 'Paper Lanterns 1983 720p HDTV', nfo: 'Encoder: crimson-team. French track.' },
    ]);
  });

  it('reads only the enabled fields', async () => {
    // The setting is not a weighting: an unticked field is not read at all.
    expect(await find('crimson', ['name'])).toEqual([
      'Crimson Vault 1994 1080p BluRay x264-NTb',
    ]);
    expect(await find('crimson', ['description'])).toEqual([
      'Northern Lights 2011 2160p WEB-DL x265',
    ]);
    expect(await find('crimson', ['nfo'])).toEqual([
      'Paper Lanterns 1983 720p HDTV',
    ]);
  });

  it('unions the enabled fields without duplicating a row that matches twice', async () => {
    const found = await find('crimson', ['name', 'description', 'nfo']);
    expect(found).toHaveLength(3);
    expect(new Set(found).size).toBe(3);
  });

  it('finds a word present only in the description', async () => {
    // This is the regression 0.25 fixes: before, search covered the name only
    // and this word was unreachable.
    expect(await find('crimson', ['name'])).not.toContain(
      'Northern Lights 2011 2160p WEB-DL x265',
    );
    expect(await find('crimson', ['name', 'description'])).toContain(
      'Northern Lights 2011 2160p WEB-DL x265',
    );
  });
});

describe('full-text search — query behaviour', () => {
  beforeEach(async () => {
    await seed([
      { name: 'Crimson Vault 1994 1080p BluRay x264-NTb' },
      { name: 'Crimson Tide 1995 1080p WEB-DL x264' },
      { name: 'Glass Cathedral 2003 720p HDTV XviD' },
      { name: 'Salt and Cedar 2019 2160p BluRay x265' },
    ]);
  });

  it('completes the last term typed', async () => {
    expect(await find('crim', ['name'])).toHaveLength(2);
    expect(await find('cathed', ['name'])).toEqual([
      'Glass Cathedral 2003 720p HDTV XviD',
    ]);
  });

  it('joins the terms with AND, not OR', async () => {
    // "crimson vault" must not bring back Crimson Tide.
    expect(await find('crimson vault', ['name'])).toEqual([
      'Crimson Vault 1994 1080p BluRay x264-NTb',
    ]);
    expect(await find('crimson tide', ['name'])).toEqual([
      'Crimson Tide 1995 1080p WEB-DL x264',
    ]);
  });

  it('ignores the case and punctuation of a release name', async () => {
    expect(await find('CRIMSON.VAULT', ['name'])).toEqual([
      'Crimson Vault 1994 1080p BluRay x264-NTb',
    ]);
    expect(await find('web dl', ['name'])).toEqual([
      'Crimson Tide 1995 1080p WEB-DL x264',
    ]);
  });

  it('does not break on input containing tsquery operators', async () => {
    // Without the scrubbing in the helper, Postgres would raise a syntax
    // error and the route would return a 500 on a single parenthesis.
    for (const evil of ['crimson & (vault', 'crimson | vault', "crim'son", '!crimson']) {
      await expect(find(evil, ['name'])).resolves.toBeInstanceOf(Array);
    }
  });

  it('returns zero results on an absent term, with no error', async () => {
    expect(await find('nonexistentword', ['name', 'description', 'nfo'])).toEqual([]);
  });
});

describe('index / query agreement', () => {
  it('the planner really does use the expression index', async () => {
    // The heart of the matter. Insert enough rows for Postgres to prefer the
    // index over a sequential scan, then read the plan. If the expression in
    // `ftsVector()` stopped matching the one declared in `schema.ts`, search
    // would remain *functionally* correct and this test would be the only
    // thing to notice.
    const rows: Row[] = [];
    for (let i = 0; i < 2000; i++) {
      rows.push({ name: `Filler Release ${i} 1080p BluRay x264-GRP` });
    }
    rows.push({ name: 'Crimson Vault 1994 1080p BluRay x264-NTb' });
    await seed(rows);

    const plan = await db.execute(
      sql`EXPLAIN SELECT id FROM torrents WHERE ${searchCondition('crimson', ['name'])}`,
    );
    const text = (plan as unknown as Array<Record<string, string>>)
      .map((r) => Object.values(r).join(' '))
      .join('\n');

    expect(text).toMatch(/torrents_fts_name_idx/);
    expect(text).not.toMatch(/Seq Scan/);
  });
});

describe('typo fallback', () => {
  beforeEach(async () => {
    await seed([{ name: 'Crimson Vault 1994 1080p BluRay x264-NTb' }]);
  });

  it('full text alone does not catch the typo', async () => {
    expect(await find('crimsen', ['name'])).toEqual([]);
  });

  it('word_similarity does catch it', async () => {
    // `word_similarity`, not `similarity`: over a whole release name the
    // global similarity stays below the threshold and never finds anything.
    const rows = await db
      .select({ name: schema.torrents.name })
      .from(schema.torrents)
      .where(sql`${'crimsen'} <% ${schema.torrents.name}`);
    expect(rows.map((r) => r.name)).toEqual([
      'Crimson Vault 1994 1080p BluRay x264-NTb',
    ]);
  });

  it('similarity over the whole string, in contrast, finds nothing', async () => {
    // The documented trap: this is what was tried first.
    const rows = await db
      .select({ name: schema.torrents.name })
      .from(schema.torrents)
      .where(sql`${schema.torrents.name} % ${'crimsen'}`);
    expect(rows).toEqual([]);
  });
});

describe('the other search modes stay intact', () => {
  it('the infohash stays an exact match served by its unique index', async () => {
    await seed([{ name: 'Crimson Vault 1994' }, { name: 'Northern Lights 2011' }]);
    const hash = '0'.repeat(40);
    const rows = await db
      .select({ name: schema.torrents.name })
      .from(schema.torrents)
      .where(eq(schema.torrents.infoHash, hash));
    expect(rows).toHaveLength(1);
  });

  it('an external id filters on its dedicated column', async () => {
    await db.insert(schema.torrents).values({
      id: randomUUID(),
      infoHash: 'f'.repeat(40),
      name: 'With an external id',
      size: 1,
      categoryId,
      imdbId: 'tt0111161',
      moderationStatus: 'accepted',
    });
    const rows = await db
      .select({ name: schema.torrents.name })
      .from(schema.torrents)
      .where(and(eq(schema.torrents.imdbId, 'tt0111161')));
    expect(rows).toHaveLength(1);
    const none = await db
      .select({ name: schema.torrents.name })
      .from(schema.torrents)
      .where(eq(schema.torrents.imdbId, 'tt9999999'));
    expect(none).toEqual([]);
  });
});
