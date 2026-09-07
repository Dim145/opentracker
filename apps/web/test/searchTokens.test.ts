import { describe, expect, it } from 'vitest';
import {
  hasSlug,
  kindOfSlug,
  tagGroupIndex,
  toggleSlug,
  parseSearchInput,
  tokensFromQuery,
  tokensToQuery,
  tokensToUrl,
  tokenLabel,
  tokenize,
} from '../app/utils/searchTokens';

describe('searchTokens', () => {
  it('sépare le texte cherché des qualificatifs', () => {
    const { tokens, text } = parseSearchInput('frieren 1080p x265 vostfr s02e04 2023 @loli');
    expect(text).toBe('frieren');
    expect(tokens.map((t) => t.kind).sort()).toEqual(
      ['codec', 'episode', 'language', 'resolution', 'season', 'uploader', 'year'].sort(),
    );
  });

  it('un codec porte tous ses synonymes, en OU', () => {
    const t = tokenize('x265')!;
    expect(t.kind).toBe('codec');
    expect(t.slugs).toEqual(expect.arrayContaining(['x265', 'hevc']));
  });

  it('deux jetons d’une même famille ne font qu’un groupe', () => {
    const { tokens } = parseSearchInput('1080p 2160p');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.slugs).toEqual(expect.arrayContaining(['1080p', '2160p']));
    expect(tokensToQuery(tokens).tagGroups).toContain('1080p');
  });

  it('les familles se croisent en ET dans tagGroups', () => {
    const { tokens } = parseSearchInput('hevc 1080p');
    const q = tokensToQuery(tokens).tagGroups!;
    expect(q.split(';')).toHaveLength(2);
  });

  it('un numéro ne vaut qu’une fois, le dernier gagne', () => {
    const { tokens } = parseSearchInput('2019 2023');
    expect(tokens.filter((t) => t.kind === 'year')).toHaveLength(1);
    expect(tokensToQuery(tokens).year).toBe('2023');
  });

  it('s02e04 devient une saison et un épisode', () => {
    const q = tokensToQuery(parseSearchInput('s02e04').tokens);
    expect(q.season).toBe('2');
    expect(q.episode).toBe('4');
  });

  it('une année hors 19xx/20xx, un mot ordinaire ou un nombre nu restent du texte', () => {
    expect(tokenize('1850')).toBeNull();
    expect(tokenize('frieren')).toBeNull();
    expect(tokenize('42')).toBeNull();
    expect(tokenize('@')).toBeNull();
  });

  it('l’URL est réversible : le mot tapé, pas ses slugs', () => {
    const { tokens } = parseSearchInput('x265 vostfr s02 e04 2023 @loli');
    const url = tokensToUrl(tokens);
    expect(url).toEqual({ tk: 'x265 vostfr', se: '2', ep: '4', y: '2023', u: 'loli' });
    const back = tokensFromQuery(url);
    expect(tokensToQuery(back)).toEqual(tokensToQuery(tokens));
    expect(back.map(tokenLabel)).toEqual(['x265', 'vostfr', 'S02', 'E04', '2023', '@loli']);
  });

  it('un lien TMDb devient un jeton d’identifiant', () => {
    const t = tokenize('https://www.themoviedb.org/tv/209867-sousou-no-frieren');
    expect(t?.kind).toBe('tmdb');
  });

  it('connaît la famille d’un slug, et l’ignore quand il n’en a pas', () => {
    expect(kindOfSlug('hevc')).toBe('codec');
    expect(kindOfSlug('2-0')).toBe('audio');
    expect(kindOfSlug('dolby-vision')).toBe('hdr');
    expect(kindOfSlug('proper')).toBeNull();
  });

  it('coche et décoche un slug depuis le rail, un jeton par famille', () => {
    let tokens = toggleSlug([], 'codec', 'hevc');
    tokens = toggleSlug(tokens, 'codec', 'x264');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.slugs).toEqual(['hevc', 'x264']);
    expect(hasSlug(tokens, 'x264')).toBe(true);
    tokens = toggleSlug(tokens, 'codec', 'hevc');
    expect(tokens[0]!.slugs).toEqual(['x264']);
    tokens = toggleSlug(tokens, 'codec', 'x264');
    expect(tokens).toEqual([]);
  });

  it('un slug coché survit à l’URL même sans alias', () => {
    const tokens = toggleSlug([], 'audio', '2-0');
    const back = tokensFromQuery(tokensToUrl(tokens));
    expect(back).toHaveLength(1);
    expect(back[0]!.kind).toBe('audio');
    expect(back[0]!.slugs).toEqual(['2-0']);
  });

  it('retrouve la place du groupe d’une famille dans tagGroups', () => {
    const { tokens } = parseSearchInput('vostfr hevc s01');
    const groups = tokensToQuery(tokens).tagGroups!.split(';');
    expect(groups[tagGroupIndex(tokens, 'language')]).toContain('vostfr');
    expect(groups[tagGroupIndex(tokens, 'codec')]).toContain('hevc');
    expect(tagGroupIndex(tokens, 'resolution')).toBe(-1);
  });

  it('ignore les paramètres d’URL mal formés', () => {
    expect(tokensFromQuery({ se: 'abc', ep: '99999', y: '1850', u: 'a b' })).toEqual([]);
  });
});

describe('le rail et l’URL disent la même chose', () => {
  it('garde exactement les slugs cochés après un aller-retour par l’URL', () => {
    // Un mot tapé étend sa famille : x265 vaut aussi hevc, h265, h-265.
    const typed = parseSearchInput('x265').tokens;
    const family = typed[0]!.slugs!;
    expect(family.length).toBeGreaterThan(1);
    // Décocher un synonyme depuis le rail.
    const pruned = toggleSlug(typed, 'codec', family[1]!);
    const kept = pruned[0]!.slugs!;
    expect(kept).not.toContain(family[1]);
    // L'URL, puis le rechargement : la liste doit revenir telle quelle.
    const back = tokensFromQuery(tokensToUrl(pruned));
    expect(back[0]!.slugs).toEqual(kept);
  });

  it('rend la case cochable et décochable sans effet de bord', () => {
    let tokens = toggleSlug([], 'resolution', '1080p');
    expect(hasSlug(tokens, '1080p')).toBe(true);
    tokens = toggleSlug(tokens, 'resolution', '2160p');
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.slugs).toEqual(['1080p', '2160p']);
    // L'URL porte UN mot, la liste exacte.
    expect(tokensToUrl(tokens).tk).toBe('1080p,2160p');
    expect(tokensFromQuery({ tk: '1080p,2160p' })[0]!.slugs).toEqual(['1080p', '2160p']);
    // Tout décocher retire la puce.
    tokens = toggleSlug(toggleSlug(tokens, 'resolution', '1080p'), 'resolution', '2160p');
    expect(tokens).toHaveLength(0);
  });

  it('affiche une liste explicite lisiblement', () => {
    const [tok] = tokensFromQuery({ tk: 'hevc,x265' });
    expect(tokenLabel(tok!)).toBe('hevc · x265');
  });

  it('ignore une liste dont les membres ne sont pas d’une même famille', () => {
    // `1080p,hevc` mélange résolution et codec : ce n'est pas une liste de rail.
    expect(tokensFromQuery({ tk: '1080p,hevc' })).toHaveLength(0);
  });
});
