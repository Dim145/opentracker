import { describe, it, expect } from 'vitest';
import { releaseChips, resolutionTier } from '../app/utils/releaseChips';

// The release row inside a group shows no filename. By the time you are in a
// group you already know the work, so the sixty characters repeated on every
// line carry nothing; what you are choosing between is the technical
// description. These chips ARE the row.
//
// That only works because the slots are FIXED. Every row puts the resolution
// in the same place in the same colour, so a member who only ever wants 2160p
// scans one column and never reads a name. Two ways it breaks, both silent:
// a token landing in the wrong slot (the eye stops finding it), and a token
// landing in no slot at all (the row goes quiet about something that matters).

describe('releaseChips', () => {
  it('reads a scene film name into its slots', () => {
    const c = releaseChips(
      'Some.Film.2011.2160p.UHD.BluRay.REMUX.HDR.HEVC.Atmos-FraMeSToR',
    );
    expect(c.resolution).toBe('2160p');
    expect(c.source).toBe('REMUX');
    expect(c.codec).toBe('HEVC');
    expect(c.audio).toBe('Atmos');
    expect(c.hdr).toBe('HDR');
  });

  it('combines the language flags rather than picking one', () => {
    // `MULTI.VFF` says something neither half says alone — several audio
    // tracks, one of which is the true French dub. Showing only `MULTI` would
    // hide the fact a French speaker is actually looking for.
    const c = releaseChips('Show.S01E01.MULTI.VFF.1080p.WEB-DL.H.264-NTb');
    expect(c.language).toBe('MULTI.VFF');
  });

  it('takes the strongest source, not the first one it sees', () => {
    // A remux is a BluRay too. The slot has to hold the claim that
    // distinguishes it from its neighbours.
    expect(releaseChips('X.2160p.BluRay.REMUX-A').source).toBe('REMUX');
    expect(releaseChips('X.1080p.BluRay.x264-A').source).toBe('BluRay');
    expect(releaseChips('X.1080p.WEB-DL.x264-A').source).toBe('WEB-DL');
  });

  it('normalises the codec spellings onto one label', () => {
    // `x265`, `H.265` and `HEVC` are the same decision. Three labels for it
    // would break the column: the eye would have to read each one.
    for (const name of ['X.1080p.x265-A', 'X.1080p.H.265-A', 'X.1080p.HEVC-A']) {
      expect(releaseChips(name).codec, name).toBe('HEVC');
    }
    for (const name of ['X.1080p.x264-A', 'X.1080p.H.264-A', 'X.1080p.AVC-A']) {
      expect(releaseChips(name).codec, name).toBe('AVC');
    }
  });

  it('reads a game as its platform', () => {
    const c = releaseChips('[PS5] Game.Title [EUR MULTI]');
    expect(c.platform).toBe('PS5');
    expect(c.resolution).toBeNull();
  });

  it('reads a book as its format', () => {
    const c = releaseChips('Book.Title.FR.[EPUB]-ebdz');
    expect(c.format).toBe('EPUB');
    expect(c.language).toBe('FR');
  });

  it('keeps the qualifiers that change what a release IS', () => {
    const c = releaseChips('Some.Film.2011.EXTENDED.PROPER.1080p.BluRay-A');
    expect(c.flags).toContain('EXTENDED');
    expect(c.flags).toContain('PROPER');
  });

  it('drops the tokens nobody chooses on', () => {
    // The parser also finds regions and version strings. A row that ends in
    // six grey pills is a row nobody reads, so only the flags that change the
    // content itself get one.
    const c = releaseChips('[PS5] Game.Title.v01.041 [EUR MULTI]');
    expect(c.flags).not.toContain('EUR');
    expect(c.flags).not.toContain('v01.041');
  });

  it('comes back empty rather than throwing on a name it cannot read', () => {
    // The row falls back to showing the filename when every slot is empty, so
    // "no chips" has to be a valid answer, not an exception.
    const c = releaseChips('some random upload');
    expect(c.resolution).toBeNull();
    expect(c.flags).toEqual([]);
    expect(() => releaseChips('')).not.toThrow();
  });
});

describe('resolutionTier', () => {
  it('maps each resolution onto the rule down the row', () => {
    // The rule is the only pre-attentive thing on the row: scanning a season
    // for "is there a 4K in here" is scanning a column of colour.
    expect(resolutionTier('2160p')).toBe('uhd');
    expect(resolutionTier('1080p')).toBe('hd');
    expect(resolutionTier('1440p')).toBe('hd');
    expect(resolutionTier('720p')).toBe('sd');
    expect(resolutionTier('480p')).toBe('low');
  });

  it('has a tier for a release that declares nothing', () => {
    expect(resolutionTier(null)).toBe('none');
  });
});
