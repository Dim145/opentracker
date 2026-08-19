import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SEARCH_FIELDS,
  SEARCH_FIELDS,
  fuzzyTerm,
  parseSearchFields,
  parseSearchFuzzy,
  toPrefixTsQuery,
} from '../utils/search';

// Full-text search helpers. Two of them hold a security boundary:
// `toPrefixTsQuery` assembles an expression Postgres will *parse* —
// `to_tsquery` interprets `&`, `|`, `!`, `:` and parentheses, so raw input
// would produce at best a 500 on a single parenthesis, at worst a query the
// user never asked for. And `parseSearchFields` decides what search reads:
// disarming it or widening it by accident changes what members see.

describe('parseSearchFields', () => {
  it('falls back to the default when the setting is absent', () => {
    expect(parseSearchFields(null)).toEqual(DEFAULT_SEARCH_FIELDS);
    expect(parseSearchFields(undefined)).toEqual(DEFAULT_SEARCH_FIELDS);
  });

  it('reads a CSV list, ignoring case and whitespace', () => {
    expect(parseSearchFields(' Name , DESCRIPTION ')).toEqual([
      'name',
      'description',
    ]);
  });

  it('accepts all four known fields', () => {
    expect(parseSearchFields(SEARCH_FIELDS.join(','))).toEqual([
      ...SEARCH_FIELDS,
    ]);
  });

  it('discards unknown fields without failing the rest', () => {
    expect(parseSearchFields('name,uploader,description')).toEqual([
      'name',
      'description',
    ]);
  });

  it('tells "nothing ticked" apart from "unreadable value"', () => {
    // The empty string is a deliberate operator choice: search no free text
    // at all. A value containing no valid field, on the other hand, is a
    // corrupted setting, and disarming search on that basis would be worse
    // than reverting to the default.
    expect(parseSearchFields('')).toEqual([]);
    expect(parseSearchFields('   ')).toEqual([]);
    expect(parseSearchFields('garbage,nonsense')).toEqual(DEFAULT_SEARCH_FIELDS);
  });

  it('keeps the NFO out of the default', () => {
    // Long, noisy text: enabling it by default would drown the relevant
    // results with nobody understanding why.
    expect(DEFAULT_SEARCH_FIELDS).not.toContain('nfo');
  });
});

describe('parseSearchFuzzy', () => {
  it('is on by default', () => {
    expect(parseSearchFuzzy(null)).toBe(true);
    expect(parseSearchFuzzy(undefined)).toBe(true);
  });

  it('only switches off on an explicit "false"', () => {
    expect(parseSearchFuzzy('false')).toBe(false);
    expect(parseSearchFuzzy(' FALSE ')).toBe(false);
    expect(parseSearchFuzzy('true')).toBe(true);
    // An unexpected value leaves tolerance on: losing typo correction is
    // noticed immediately, keeping it breaks nothing.
    expect(parseSearchFuzzy('0')).toBe(true);
    expect(parseSearchFuzzy('garbage')).toBe(true);
  });
});

describe('toPrefixTsQuery', () => {
  it('prefixes the last term and ANDs the others', () => {
    expect(toPrefixTsQuery('crimson')).toBe('crimson:*');
    expect(toPrefixTsQuery('crimson vault')).toBe('crimson & vault:*');
    expect(toPrefixTsQuery('a b c')).toBe('a & b & c:*');
  });

  it('folds case', () => {
    expect(toPrefixTsQuery('CrimSON')).toBe('crimson:*');
  });

  it('keeps accented letters', () => {
    expect(toPrefixTsQuery('intégrale')).toBe('intégrale:*');
    expect(toPrefixTsQuery('日本語')).toBe('日本語:*');
  });

  it('neutralises tsquery operators instead of forwarding them', () => {
    // Without this scrubbing, `to_tsquery` would raise a syntax error on the
    // slightest parenthesis and search would return a 500.
    for (const input of [
      'a & b',
      'a | b',
      '!a',
      '(a)',
      "a:b",
      'a <-> b',
      "'; DROP TABLE torrents; --",
    ]) {
      const out = toPrefixTsQuery(input);
      expect(out).not.toBeNull();
      // Only the trailing `:*` is an operator; the rest is text and the
      // conjunctions we placed ourselves.
      expect(out!.replace(/ & /g, ' ').replace(/:\*$/, '')).toMatch(
        /^[\p{L}\p{N} ]*$/u,
      );
    }
  });

  it('splits on the punctuation of a release name', () => {
    expect(toPrefixTsQuery('Crimson.Vault.1994.1080p')).toBe(
      'crimson & vault & 1994 & 1080p:*',
    );
    expect(toPrefixTsQuery('WEB-DL')).toBe('web & dl:*');
  });

  it('returns null when nothing usable is left', () => {
    // The caller must then skip the filter rather than return an empty page.
    for (const input of ['', '   ', '***', '&&&', '()']) {
      expect(toPrefixTsQuery(input)).toBeNull();
    }
  });
});

describe('fuzzyTerm', () => {
  it('accepts a single word of at least three characters', () => {
    expect(fuzzyTerm('crimsen')).toBe('crimsen');
    expect(fuzzyTerm('ABC')).toBe('abc');
  });

  it('refuses anything below three characters', () => {
    // Below three characters there is no trigram at all, so the index can do
    // nothing and the fallback would be a full scan.
    expect(fuzzyTerm('ab')).toBeNull();
    expect(fuzzyTerm('a')).toBeNull();
  });

  it('refuses as soon as there are several words', () => {
    // `word_similarity` compares word to word and says nothing about the
    // combination: on several terms the fallback would be both expensive and
    // wrong.
    expect(fuzzyTerm('crimsen vault')).toBeNull();
    expect(fuzzyTerm('crimson.vault')).toBeNull();
  });

  it('refuses empty input or input with no usable character', () => {
    expect(fuzzyTerm('')).toBeNull();
    expect(fuzzyTerm('***')).toBeNull();
  });
});
