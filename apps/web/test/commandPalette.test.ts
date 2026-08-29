import { describe, expect, it } from 'vitest';
import {
  rankPaletteItems,
  scoreItem,
  scoreMatch,
  type PaletteItem,
} from '../app/utils/commandPalette';

// The ranking behind the ⌘K palette. It mixes four kinds of result — menus,
// actions, torrents, members — into one list, so the ordering is the whole
// feature: get it wrong and Enter lands somewhere the reader did not intend.

function item(partial: Partial<PaletteItem> & { label: string }): PaletteItem {
  return {
    id: partial.label,
    group: 'navigation',
    icon: 'ph:dot',
    to: '/',
    ...partial,
  };
}

describe('scoreMatch', () => {
  it('ranks exact over prefix over substring over subsequence', () => {
    const exact = scoreMatch('torrents', 'torrents');
    const prefix = scoreMatch('torrents', 'tor');
    const substring = scoreMatch('my torrents', 'torrents');
    const subsequence = scoreMatch('moderation reports', 'tor');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(subsequence).toBeGreaterThan(0);
  });

  it('returns zero when a character is missing or out of order', () => {
    expect(scoreMatch('torrents', 'zzz')).toBe(0);
    // Every letter is present, but not in this order.
    expect(scoreMatch('torrents', 'stnerrot')).toBe(0);
  });

  it('is accent- and case-blind in both directions', () => {
    expect(scoreMatch('Fédération', 'federation')).toBe(1000);
    expect(scoreMatch('Federation', 'fédé')).toBe(800);
    expect(scoreMatch('ÉCONOMIE', 'economie')).toBe(1000);
  });

  it('scores a longer subsequence above a shorter one', () => {
    // Two scattered characters are far likelier to be coincidence than six.
    expect(scoreMatch('admin users', 'adminus')).toBeGreaterThan(
      scoreMatch('admin users', 'as')
    );
  });

  it('treats an empty needle as a match so the unfiltered list survives', () => {
    expect(scoreMatch('anything', '')).toBeGreaterThan(0);
  });
});

describe('scoreItem', () => {
  it('falls back to keywords when the label does not carry the word', () => {
    const banned = item({ label: 'Banned IPs', keywords: 'ban block blocklist' });
    expect(scoreItem(banned, 'blocklist')).toBeGreaterThan(0);
  });

  it('discounts a keyword hit below a label hit of the same strength', () => {
    // Both are exact matches; only one of them is on screen to explain itself.
    const byLabel = item({ label: 'shop' });
    const byKeyword = item({ label: 'Bonus store', keywords: 'shop' });
    expect(scoreItem(byLabel, 'shop')).toBeGreaterThan(
      scoreItem(byKeyword, 'shop')
    );
  });

  it('will not reach a keyword by subsequence', () => {
    // The regression this guards: keywords are whole descriptions, and over a
    // sentence a subsequence match nearly always succeeds. Typing a member's
    // name surfaced two unrelated admin pages above them.
    const rules = item({
      label: 'Earning Rules',
      keywords: 'Configure how users earn bonus points and the tier curves',
    });
    expect(scoreItem(rules, 'founder')).toBe(0);
    // A substring in the same keywords still lands.
    expect(scoreItem(rules, 'bonus points')).toBeGreaterThan(0);
  });

  it('still reaches a label by subsequence', () => {
    expect(scoreItem(item({ label: 'Admin Users' }), 'adus')).toBeGreaterThan(0);
  });

  it('ignores keywords entirely once the label matches', () => {
    const both = item({ label: 'Users', keywords: 'users' });
    expect(scoreItem(both, 'users')).toBe(scoreMatch('Users', 'users'));
  });
});

describe('rankPaletteItems', () => {
  const ITEMS = [
    item({ label: 'Torrents', to: '/torrents' }),
    item({ label: 'Moderation reports', to: '/mod' }),
    item({ label: 'Upload a torrent', group: 'actions', to: '/torrents/upload' }),
    item({ label: 'Some.Release.2026.1080p', group: 'torrents', to: '/t/1' }),
  ];

  it('returns everything, in order, for an empty query', () => {
    // The palette opens on this view; reordering or truncating it would make
    // the panel look different every time it is opened.
    expect(rankPaletteItems(ITEMS, '')).toEqual(ITEMS);
    expect(rankPaletteItems(ITEMS, '   ')).toEqual(ITEMS);
  });

  it('puts the strongest match first', () => {
    const hits = rankPaletteItems(ITEMS, 'torrents');
    expect(hits[0]?.label).toBe('Torrents');
  });

  it('drops what does not match at all', () => {
    expect(rankPaletteItems(ITEMS, 'zzzz')).toEqual([]);
  });

  it('keeps input order between equally-scored hits', () => {
    // Stability matters: equal matches must not shuffle between keystrokes.
    const tied = [
      item({ label: 'Alpha', id: 'a' }),
      item({ label: 'Alpha', id: 'b' }),
      item({ label: 'Alpha', id: 'c' }),
    ];
    expect(rankPaletteItems(tied, 'alpha').map((i) => i.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 90 }, (_, i) =>
      item({ label: `Torrent ${i}`, id: String(i) })
    );
    expect(rankPaletteItems(many, 'torrent')).toHaveLength(40);
    expect(rankPaletteItems(many, 'torrent', 5)).toHaveLength(5);
  });
});
