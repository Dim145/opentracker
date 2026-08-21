import { describe, it, expect } from 'vitest';
import { splitReleaseName } from '../app/utils/releaseNameSplit';

// The cut that makes a group readable: inside a group every release is the
// same work, so the words naming it repeat on every row and carry nothing.
// Dimming that half and leaving the rest bright is the whole design of the
// release row — and it is only worth anything if the cut lands in the right
// place. Two ways it can go wrong, and both are silent:
//
//   - Cutting too late leaves the rows looking identical, which is the
//     problem the treatment exists to solve.
//   - Cutting too early dims the one thing that distinguishes a row. On a
//     game group that is the platform tag, and a member reading `[PS5]` in
//     the same grey as the title has been shown nothing at all.

describe('splitReleaseName', () => {
  it('dims the title and keeps the technical tail bright', () => {
    expect(splitReleaseName('Some.Film.2011.1080p.BluRay.x264-NTb')).toEqual({
      tag: '',
      lead: 'Some.Film.2011.',
      tail: '1080p.BluRay.x264-NTb',
    });
  });

  it('cuts at the episode code rather than at the series name', () => {
    // The row already sits under "S03", so the useful half starts at the
    // resolution — but the episode number must stay legible, which it does
    // because the cut lands after it.
    const parts = splitReleaseName('Show.Name.S03E02.2160p.WEB-DL.DV.HDR-NTb');
    expect(parts.lead).toBe('Show.Name.S03E02.');
    expect(parts.tail).toBe('2160p.WEB-DL.DV.HDR-NTb');
  });

  it('keeps a platform tag out of the dimmed half', () => {
    // On a game group the bracket is often the ONLY difference between rows.
    expect(splitReleaseName('[PS5] Game.Title [EUR MULTI]')).toEqual({
      tag: '[PS5] ',
      lead: 'Game.Title ',
      tail: '[EUR MULTI]',
    });
    expect(splitReleaseName('[XBOX] Game.Title [EUR]')).toEqual({
      tag: '[XBOX] ',
      lead: 'Game.Title ',
      tail: '[EUR]',
    });
  });

  it('cuts at a trailing bracket even when no technical token follows', () => {
    // Book formats: `[EPUB]` against `[PDF]` against `[CBZ]`.
    expect(splitReleaseName('Book.Title.FR.[EPUB]-ebdz')).toEqual({
      tag: '',
      lead: 'Book.Title.FR.',
      tail: '[EPUB]-ebdz',
    });
  });

  it('cuts at whichever comes first, the bracket or the token', () => {
    const bracketFirst = splitReleaseName('Title [PROPER] 1080p.BluRay');
    expect(bracketFirst.lead).toBe('Title ');
    expect(bracketFirst.tail).toBe('[PROPER] 1080p.BluRay');

    const tokenFirst = splitReleaseName('Title 1080p.BluRay [PROPER]');
    expect(tokenFirst.lead).toBe('Title ');
    expect(tokenFirst.tail).toBe('1080p.BluRay [PROPER]');
  });

  it('leaves a name it cannot read entirely bright', () => {
    // Better an undimmed row than one that hides its only content behind a
    // bad guess.
    expect(splitReleaseName('Some Untagged Upload')).toEqual({
      tag: '',
      lead: '',
      tail: 'Some Untagged Upload',
    });
    expect(splitReleaseName('')).toEqual({ tag: '', lead: '', tail: '' });
  });

  it('never dims a whole name by cutting at position zero', () => {
    // A name that IS its technical description has no title half to dim.
    for (const name of ['1080p.BluRay.x264-NTb', 'MULTI.Release-GRP']) {
      const parts = splitReleaseName(name);
      expect(parts.lead).toBe('');
      expect(parts.tail).toBe(name);
    }
  });

  it('does not accent a long bracketed opening as if it were a platform', () => {
    // The tag is capped at 24 characters. Past that the bracket is content,
    // not a platform, so it stays in the dimmed title half and the cut falls
    // where it would have anyway — at the first technical token.
    const parts = splitReleaseName('[A Very Long Bracketed Opening Indeed] Title 1080p');
    expect(parts.tag).toBe('');
    expect(parts.lead).toBe('[A Very Long Bracketed Opening Indeed] Title ');
    expect(parts.tail).toBe('1080p');
  });

  it('reassembles into the original name', () => {
    for (const name of [
      'Some.Film.2011.1080p.BluRay.x264-NTb',
      '[PS5] Game.Title [EUR MULTI]',
      'Book.Title.FR.[EPUB]-ebdz',
      'Some Untagged Upload',
      '  [PC]  Spaced.Out.Name  ',
    ]) {
      const { tag, lead, tail } = splitReleaseName(name);
      expect(tag + lead + tail).toBe(name);
    }
  });
});
