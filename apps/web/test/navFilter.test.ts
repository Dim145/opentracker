import { describe, expect, it } from 'vitest';
import { filterNavItems, foldForSearch } from '../app/utils/navFilter';

// The filter behind the admin sidebar. Twenty destinations is past the point
// where scanning beats typing, so this is the fast path — and it is the reason
// the accordion below it can afford to keep four groups shut at a time.

const SECTIONS = [
  { label: 'Dashboard', description: 'Tracker configuration and node management' },
  { label: 'Users', description: 'Manage user accounts and permissions' },
  { label: 'Banned IPs', description: 'View, add and remove IPs from the auth blocklist' },
  { label: 'Économie', description: 'Bonus points and the shop' },
  { label: 'Themes', description: 'Create and edit the themes members can choose' },
  { label: 'Settings' },
];

describe('foldForSearch', () => {
  it('strips diacritics and case', () => {
    expect(foldForSearch('Économie')).toBe('economie');
    expect(foldForSearch('Intégrations')).toBe('integrations');
    expect(foldForSearch('Fédération')).toBe('federation');
  });

  it('leaves unaccented text alone', () => {
    expect(foldForSearch('Banned IPs')).toBe('banned ips');
  });
});

describe('filterNavItems', () => {
  it('returns nothing for an empty or blank query', () => {
    // Not "everything": a stray space must not look like a flattened menu.
    expect(filterNavItems(SECTIONS, '')).toEqual([]);
    expect(filterNavItems(SECTIONS, '   ')).toEqual([]);
  });

  it('matches a label case-insensitively, anywhere in it', () => {
    expect(filterNavItems(SECTIONS, 'user').map((s) => s.label)).toEqual(['Users']);
    expect(filterNavItems(SECTIONS, 'IPS').map((s) => s.label)).toEqual(['Banned IPs']);
  });

  it('finds an accented label from an unaccented query', () => {
    // The whole point: nobody types the acute accent into a filter box.
    expect(filterNavItems(SECTIONS, 'economie').map((s) => s.label)).toEqual([
      'Économie',
    ]);
    expect(filterNavItems(SECTIONS, 'écono').map((s) => s.label)).toEqual([
      'Économie',
    ]);
  });

  it('falls back to the description when the label does not carry the word', () => {
    // "ban" is in no label but is what you would type to find Banned IPs.
    expect(filterNavItems(SECTIONS, 'blocklist').map((s) => s.label)).toEqual([
      'Banned IPs',
    ]);
  });

  it('puts label hits ahead of description-only hits', () => {
    // "Themes" matches its own label; "Économie" only matches through its
    // description. Enter jumps to the first result, so this order is what
    // decides where the key lands.
    const hits = filterNavItems(
      [
        { label: 'Économie', description: 'Bonus points and the theme shop' },
        { label: 'Themes', description: 'Create and edit them' },
      ],
      'theme'
    );
    expect(hits.map((s) => s.label)).toEqual(['Themes', 'Économie']);
  });

  it('lists an item that matches both label and description once', () => {
    const hits = filterNavItems(
      [{ label: 'Themes', description: 'Edit the themes members can choose' }],
      'themes'
    );
    expect(hits).toHaveLength(1);
  });

  it('tolerates an item with no description', () => {
    expect(filterNavItems(SECTIONS, 'settings').map((s) => s.label)).toEqual([
      'Settings',
    ]);
    expect(filterNavItems(SECTIONS, 'nothing here')).toEqual([]);
  });
});
