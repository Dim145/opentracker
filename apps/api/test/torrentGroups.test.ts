import { describe, it, expect } from 'vitest';
import { parseGroupKey } from '../utils/torrentGroups';

// `parseGroupKey` sits on the boundary between a URL and a SQL predicate: the
// grouped listing hands the key straight to `/torrents/group/<key>`, so
// whatever a member types in the address bar reaches this function. Two
// properties matter and neither is obvious from the shape of the code.
//
// It must be TOTAL. A key it cannot read has to come back as an empty group,
// not as an exception — `groupMemberWhere` runs on whatever comes out, and a
// throw here is a 500 on a page anybody can request.
//
// And the round trip has to hold. The key is built in SQL by `groupKeySql`
// and taken apart again here in TypeScript; if the two drift, the listing
// keeps grouping correctly while every group link lands on an empty page — a
// failure that looks like missing data rather than a bug. The integration
// suite asserts that half; this one covers the parsing.

describe('parseGroupKey', () => {
  it('reads a film as its namespaced TMDb id', () => {
    expect(parseGroupKey('tmdb:movie/603')).toEqual({
      source: 'tmdb',
      externalId: 'movie/603',
    });
  });

  it('reads a series as the SERIES, not as one of its seasons', () => {
    // The key deliberately carries no season. An earlier version put one in
    // (`tmdb:tv/1396:s03`), which made a three-season show three unrelated
    // entries in the catalogue; the season is now a scope inside the group.
    expect(parseGroupKey('tmdb:tv/1396')).toEqual({
      source: 'tmdb',
      externalId: 'tv/1396',
    });
  });

  it('carries a game and a book through untouched', () => {
    expect(parseGroupKey('igdb:1020')).toEqual({
      source: 'igdb',
      externalId: '1020',
    });
    expect(parseGroupKey('openlibrary:OL27258011M')).toEqual({
      source: 'openlibrary',
      externalId: 'OL27258011M',
    });
  });

  it('reads a solo key as the torrent id it holds', () => {
    const id = '5f5c1f4e-2b9a-4a4f-9d4c-0b6d2f7c1a33';
    expect(parseGroupKey(`solo:${id}`)).toEqual({
      source: 'solo',
      externalId: id,
    });
  });

  it('is total — a malformed key degrades instead of throwing', () => {
    for (const key of ['', 'nonsense', 'tmdb:', 'unknownsource:42', '::::']) {
      expect(() => parseGroupKey(key)).not.toThrow();
      expect(parseGroupKey(key).source).toBeTypeOf('string');
    }
  });

  it('treats an unknown prefix as solo rather than trusting it', () => {
    // The predicate built from a `solo` key compares against a torrent id and
    // finds nothing, which is the correct answer for a key we never produced.
    expect(parseGroupKey('imdb:tt0111161')).toEqual({
      source: 'solo',
      externalId: 'tt0111161',
    });
  });

  it('keeps the first colon as the separator so ids may contain colons', () => {
    expect(parseGroupKey('openlibrary:OL1:2M')).toEqual({
      source: 'openlibrary',
      externalId: 'OL1:2M',
    });
  });
});
