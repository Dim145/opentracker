import { describe, expect, it } from 'vitest';
import { groupVersions, versionKey } from '../app/utils/releaseVersions';
import { homeScope, scopesOf, unitsOf } from '../app/utils/workUnits';
import { categoryRows, familyRows } from '../app/utils/catalogueFacets';

describe('versions d’un même contenu', () => {
  const w = { source: 'tmdb', id: 'tv/209867' };
  it('regroupe même œuvre + même unité, la première en tête', () => {
    const rows = [
      { id: 'a', season: 1, episode: 9, work: w },
      { id: 'b', season: 1, episode: 9, work: w },
      { id: 'c', season: 1, episode: 10, work: w },
    ];
    const g = groupVersions(rows);
    expect(g).toHaveLength(2);
    expect(g[0]!.lead.id).toBe('a');
    expect(g[0]!.others.map((r) => r.id)).toEqual(['b']);
    expect(g[1]!.lead.id).toBe('c');
  });
  it('ne regroupe jamais sans œuvre connue', () => {
    const rows = [{ id: 'a', season: 1, episode: 9, work: null }, { id: 'b', season: 1, episode: 9, work: null }];
    expect(groupVersions(rows)).toHaveLength(2);
    expect(versionKey(rows[0]!)).toBeNull();
  });
  it('un pack de saison et un épisode ne sont pas la même unité', () => {
    const rows = [{ id: 'a', season: 1, episode: null, work: w }, { id: 'b', season: 1, episode: 9, work: w }];
    expect(groupVersions(rows)).toHaveLength(2);
  });
});

describe('découpes d’une œuvre', () => {
  const scopes = [
    { scope: 'integral' as const, units: 1, latest: '2026-01-01' },
    { scope: 'episode' as const, units: 2, latest: '2026-03-01' },
    { scope: 'season' as const, units: 1, latest: '2026-02-01' },
    { scope: 'all' as const, units: 0, latest: '2026-02-01' },
  ];
  it('range épisode, saison, intégrale et retire ce qui est vide', () => {
    expect(scopesOf(scopes).map((s) => s.scope)).toEqual(['episode', 'season', 'integral']);
  });
  it('met en avant la découpe du premier torrent du tri si elle existe', () => {
    expect(homeScope({ scopes, firstScope: 'season', defaultScope: 'episode' })).toBe('season');
    expect(homeScope({ scopes, firstScope: 'all', defaultScope: 'episode' })).toBe('episode');
    expect(homeScope({ scopes: [] })).toBe('all');
  });
  it('découpe en unités selon la portée ouverte', () => {
    const rows = [
      { id: 'e10', season: 1, episode: 10 },
      { id: 'e9', season: 1, episode: 9 },
      { id: 'e9b', season: 1, episode: 9 },
      { id: 's1', season: 1, episode: null },
      { id: 'int', season: null, episode: null },
    ];
    const ep = unitsOf(rows.filter((r) => r.episode !== null), 'episode');
    expect(ep.map((u) => u.key)).toEqual(['e1-10', 'e1-9']);
    expect(ep[1]!.rows).toHaveLength(2);
    const all = unitsOf(rows, 'all');
    expect(all.map((u) => u.kind)).toEqual(['episode', 'episode', 'season', 'all']);
    expect(unitsOf([rows[4]!], 'integral')[0]!.kind).toBe('integral');
  });
});

describe('rail de facettes', () => {
  it('les enfants comptent pour leur parent, les vides disparaissent, le coché reste', () => {
    const cats = [
      { id: 'p1', name: 'Séries', slug: 'series', parentId: null, subcategories: [{ id: 'c1', name: 'Anime', slug: 'anime', parentId: 'p1' }] },
      { id: 'p2', name: 'Films', slug: 'films', parentId: null, subcategories: [] },
      { id: 'p3', name: 'Livres', slug: 'livres', parentId: null, subcategories: [] },
    ];
    const rows = categoryRows(cats, [{ id: 'c1', count: 4 }, { id: 'p1', count: 1 }, { id: 'p2', count: 2 }], 'p3');
    expect(rows.map((r) => [r.id, r.count])).toEqual([['p1', 5], ['p2', 2], ['p3', 0]]);
    expect(rows[0]!.kids).toEqual([{ id: 'c1', name: 'Anime', count: 4 }]);
  });
  it('une famille qui a posé un groupe lit les comptes sans elle-même', () => {
    const facets = {
      tags: [{ slug: '1080p', name: '1080p', count: 3 }, { slug: 'x265', name: 'x265', count: 2 }],
      tagsByGroup: { '0': [{ slug: '1080p', name: '1080p', count: 17 }, { slug: '2160p', name: '2160p', count: 3 }] },
    };
    const isRes = (s: string) => /p$/.test(s);
    expect(familyRows(facets, 0, isRes).map((r) => r.slug)).toEqual(['1080p', '2160p']);
    expect(familyRows(facets, -1, isRes).map((r) => r.slug)).toEqual(['1080p']);
  });
});
