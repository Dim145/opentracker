import { describe, it, expect } from 'vitest';
import {
  mergeParsedTags,
  parseNfoForTags,
  parseReleaseName,
} from '../app/utils/releaseParse';
import { detectMediaId, mediaIdQueryParam } from '../app/utils/mediaIdDetect';

// Release-name parsing.
//
// The member drops a file and the form fills itself in: cleaned title, year,
// season/episode, scene tags. Nothing here is blocking — which is exactly what
// makes the function risky. A mistake raises no exception, it merely proposes
// the wrong title, fires the metadata lookup against the wrong work, and the
// upload ships with a wrong listing nobody will re-read.
//
// The two structural traps are pinned here: the title/metadata split (looking
// for tags BEFORE the cut surfaces "Web" out of a title containing that word)
// and the choice of tag table by inferred kind (games announce their platform
// BEFORE the title, films their codec after).

describe('parseReleaseName — films', () => {
  it('separates the title from the technical tail', () => {
    const r = parseReleaseName('Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-FraMeSToR');
    expect(r.title).toBe('Dune Part Two');
    expect(r.year).toBe(2024);
    expect(r.kind).toBe('movie');
    expect(r.tags).toContain('2160p');
    expect(r.tags).toContain('HEVC');
  });

  it('accepts any separator', () => {
    for (const name of [
      'Le Grand Bleu 1988 1080p BluRay x264-TEAM',
      'Le_Grand_Bleu_1988_1080p_BluRay_x264-TEAM',
      'Le.Grand.Bleu.1988.1080p.BluRay.x264-TEAM',
    ]) {
      const r = parseReleaseName(name);
      expect(r.title).toBe('Le Grand Bleu');
      expect(r.year).toBe(1988);
    }
  });

  it('strips the extension and the group', () => {
    const r = parseReleaseName('Title.2020.1080p.WEB-DL.x264-GROUP.mkv');
    expect(r.title).toBe('Title');
    expect(r.tags).not.toContain('GROUP');
  });

  it('only looks for tags after the cut', () => {
    // "Extended" is a known quality tag. Since it appears before the first
    // stop token (the year), it belongs to the title and must not surface as
    // a tag.
    const r = parseReleaseName('Extended.Family.2024.1080p.WEB-DL.x264-TEAM');
    expect(r.title).toBe('Extended Family');
    expect(r.tags).toContain('WEB-DL');
    expect(r.tags).not.toContain('EXTENDED');
  });

  it('truncates the title when one of its words is itself a stop token', () => {
    // Known and accepted limitation: "Web" is how the source is spotted, so a
    // title containing that word is cut there. The member fixes it in the
    // form; the prefill is only a suggestion. This test exists so that the day
    // the cut gets smarter, we know about it.
    expect(parseReleaseName('Charlotte.Web.2006.1080p.BluRay.x264-TEAM').title).toBe(
      'Charlotte',
    );
  });
});

describe('parseReleaseName — series', () => {
  it('reads the SxxExx form', () => {
    const r = parseReleaseName('The.Mandalorian.S03E01.1080p.WEB.DDP5.1.H.264-NTb');
    expect(r.title).toBe('The Mandalorian');
    expect(r.season).toBe(3);
    expect(r.episode).toBe(1);
    expect(r.kind).toBe('tv');
  });

  it('also reads the 1x01 and "Season 2" forms', () => {
    const a = parseReleaseName('Some.Series.2x05.1080p.WEB-DL');
    expect([a.season, a.episode]).toEqual([2, 5]);

    const b = parseReleaseName('Some.Series.Season.2.1080p.WEB-DL');
    expect(b.season).toBe(2);
    expect(b.episode).toBeNull();
  });

  it('handles a complete season with no episode', () => {
    const r = parseReleaseName('Some.Series.S01.COMPLETE.1080p.WEB-DL');
    expect(r.season).toBe(1);
    expect(r.episode).toBeNull();
  });

  it('accepts a four-digit episode number', () => {
    // Long-running animated series need it.
    const r = parseReleaseName('Some.Anime.S01E1024.1080p.WEB-DL');
    expect(r.episode).toBe(1024);
  });
});

describe('parseReleaseName — games and books', () => {
  it('removes the platform bracket from the title and keeps it as a tag', () => {
    const r = parseReleaseName('[PS5] Kingdom.Come.Deliverance.2 [EUR MULTI]');
    expect(r.kind).toBe('game');
    expect(r.title).toBe('Kingdom Come Deliverance 2');
    expect(r.tags).toContain('PS5');
  });

  it('recognises a version stamp', () => {
    const r = parseReleaseName('[PC] Some.Game.v1.2.3');
    expect(r.tags.some((t) => t.toLowerCase().includes('v1.2.3'))).toBe(true);
  });

  it('recognises a book format and its volume range', () => {
    const r = parseReleaseName('Some.Series.[T01.T05].FR.[CBZ]-ebdz');
    expect(r.kind).toBe('book');
    expect(r.tags).toContain('CBZ');
  });

  it('lets the caller hint win over the guess', () => {
    // The category the member picked carries more context than the filename,
    // so it wins.
    const r = parseReleaseName('Some.Ambiguous.Title.2024', 'book');
    expect(r.kind).toBe('book');
  });
});

describe('parseReleaseName — degraded cases', () => {
  it('does not break on empty or structureless input', () => {
    for (const name of ['', '   ', 'nostructure']) {
      const r = parseReleaseName(name);
      expect(r.year).toBeNull();
      expect(Array.isArray(r.tags)).toBe(true);
    }
  });

  it('does not take just any four-digit number for a year', () => {
    expect(parseReleaseName('Title.12345.1080p.WEB-DL').year).toBeNull();
  });

  it('never returns a duplicate tag', () => {
    const r = parseReleaseName('Title.2024.1080p.1080p.BluRay.BluRay.x264');
    expect(new Set(r.tags).size).toBe(r.tags.length);
  });
});

describe('mergeParsedTags', () => {
  it('adds only what is missing, with no case-duplicate', () => {
    const { merged, added } = mergeParsedTags(['1080p'], ['1080P', 'BluRay']);
    expect(merged).toEqual(['1080p', 'BluRay']);
    expect(added).toEqual(['BluRay']);
  });

  it('keeps the spelling the member already typed', () => {
    const { merged } = mergeParsedTags(['BluRay'], ['bluray']);
    expect(merged).toEqual(['BluRay']);
  });

  it('ignores empty entries', () => {
    const { merged } = mergeParsedTags(['  ', ''], ['x', '   ']);
    expect(merged).toEqual(['x']);
  });
});

describe('parseNfoForTags', () => {
  it('strips the BBCode before looking for tags', () => {
    const tags = parseNfoForTags('[b]Video codec:[/b] [i]H.265[/i] — [b]Source:[/b] BluRay');
    expect(tags).toContain('HEVC');
    expect(tags).toContain('BluRay');
  });

  it('strips HTML too and decodes entities', () => {
    const tags = parseNfoForTags('<p>Resolution&nbsp;: <b>2160p</b></p>');
    expect(tags).toContain('2160p');
  });

  it('does not let an unclosed bracket eat the document', () => {
    // The `{0,256}` bound exists for this: without it a stray `[` swallowed
    // everything up to the next `]`, miles away, and the NFO came back empty.
    const nfo = `[unclosed ${'x'.repeat(500)} 1080p BluRay`;
    expect(parseNfoForTags(nfo)).toContain('1080p');
  });

  it('does not double-decode an escaped entity', () => {
    // `&amp;lt;` is what the member actually typed: it must stay `&lt;`, not
    // cascade back down to `<`.
    expect(() => parseNfoForTags('&amp;lt;script&amp;gt; 1080p')).not.toThrow();
    expect(parseNfoForTags('&amp;lt;script&amp;gt; 1080p')).toContain('1080p');
  });

  it('returns an empty list rather than throwing', () => {
    expect(parseNfoForTags(null)).toEqual([]);
    expect(parseNfoForTags('')).toEqual([]);
    expect(parseNfoForTags('[b][/b]')).toEqual([]);
  });
});

describe('detectMediaId', () => {
  it('recognises a pasted or typed IMDb id', () => {
    expect(detectMediaId('tt0133093')).toMatchObject({ source: 'imdb', id: 'tt0133093' });
    expect(detectMediaId('https://www.imdb.com/title/tt0133093/')).toMatchObject({
      source: 'imdb',
      id: 'tt0133093',
    });
  });

  it('recognises a TMDb URL and keeps its namespace', () => {
    // The `tv/` prefix has to survive, otherwise the search runs against the
    // wrong scope on the API side.
    expect(detectMediaId('https://www.themoviedb.org/tv/1396')).toMatchObject({
      source: 'tmdb',
      id: 'tv/1396',
      display: '1396',
    });
  });

  it('re-reads the prefixed form when the page reloads', () => {
    expect(detectMediaId('movie/603')).toMatchObject({ source: 'tmdb', display: '603' });
  });

  it('recognises TVDB by path as well as by query parameter', () => {
    expect(detectMediaId('https://thetvdb.com/series/12345')?.source).toBe('tvdb');
    expect(detectMediaId('https://thetvdb.com/x?id=999')?.source).toBe('tvdb');
  });

  it('stays silent on anything ambiguous', () => {
    // A bare run of digits is most often a year or noise: switching to
    // "search by id" on that would make every result vanish with no
    // explanation.
    for (const input of ['1999', '', '   ', 'Matrix', 'tt12']) {
      expect(detectMediaId(input)).toBeNull();
    }
  });

  it('names the right query parameter', () => {
    expect(mediaIdQueryParam('imdb')).toBe('imdbid');
    expect(mediaIdQueryParam('tmdb')).toBe('tmdbid');
    expect(mediaIdQueryParam('tvdb')).toBe('tvdbid');
  });
});
