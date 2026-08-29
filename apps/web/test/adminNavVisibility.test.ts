import { describe, expect, it } from 'vitest';
import {
  visibleAdminGroups,
  type AdminNavGroup,
} from '../app/composables/useAdminNav';

// The owner guard on the admin destination list.
//
// Nothing sets `ownerOnly` today — all twenty admin pages sit behind
// `middleware: 'admin'`, and what the owner alone may do are operations inside
// those pages, guarded by `requireOwnerSession` on the API. The flag and this
// test exist so the first owner-only page cannot be added without the filter
// already being in place and proven: two surfaces read this list (the admin
// sidebar and the ⌘K palette) and neither does any filtering of its own.

function group(
  key: string,
  items: Array<{ label: string; ownerOnly?: boolean }>
): AdminNavGroup {
  return {
    key,
    label: key,
    icon: 'ph:dot',
    items: items.map((item) => ({
      label: item.label,
      path: `/admin/${item.label}`,
      icon: 'ph:dot',
      description: '',
      ownerOnly: item.ownerOnly,
    })),
  };
}

const GROUPS = [
  group('members', [{ label: 'users' }, { label: 'roles', ownerOnly: true }]),
  group('appearance', [{ label: 'branding' }]),
  group('ownership', [{ label: 'transfer', ownerOnly: true }]),
];

describe('visibleAdminGroups', () => {
  it('gives the owner everything, untouched', () => {
    expect(visibleAdminGroups(GROUPS, true)).toEqual(GROUPS);
  });

  it('drops owner-only entries for everyone else', () => {
    const seen = visibleAdminGroups(GROUPS, false)
      .flatMap((g) => g.items)
      .map((i) => i.label);
    expect(seen).toEqual(['users', 'branding']);
  });

  it('drops a group left empty by the filter', () => {
    // A section whose every page is owner-only must not show as a bare
    // heading — that still tells a non-owner the section exists.
    expect(visibleAdminGroups(GROUPS, false).map((g) => g.key)).toEqual([
      'members',
      'appearance',
    ]);
  });

  it('does not mutate the list it was given', () => {
    const before = JSON.stringify(GROUPS);
    visibleAdminGroups(GROUPS, false);
    expect(JSON.stringify(GROUPS)).toBe(before);
  });

  it('is a no-op while nothing is flagged', () => {
    // Today's real shape: the filter must be invisible until someone uses it.
    const plain = [group('members', [{ label: 'users' }])];
    expect(visibleAdminGroups(plain, false)).toEqual(plain);
  });
});
