import { describe, it, expect } from 'vitest';
import { deriveAction, isAuditable } from '../utils/audit';

// The audit log's coverage is structural: a hook logs every mutating staff
// request whether or not the route says anything about itself. Which makes
// these two pure functions the whole gate — one decides what gets a row, the
// other decides what that row is called for the majority of routes that never
// call `auditDetail`.

describe('isAuditable', () => {
  it('takes mutating methods on the staff consoles', () => {
    expect(isAuditable('POST', '/api/admin/users/abc/ban')).toBe(true);
    expect(isAuditable('PUT', '/api/admin/settings')).toBe(true);
    expect(isAuditable('PATCH', '/api/mod/reports/1')).toBe(true);
    expect(isAuditable('DELETE', '/api/admin/tags/9')).toBe(true);
    expect(isAuditable('post', '/api/admin/panic/encrypt')).toBe(true);
  });

  it('ignores reads', () => {
    // A register of authority records decisions, not who looked at a page.
    expect(isAuditable('GET', '/api/admin/users')).toBe(false);
    expect(isAuditable('HEAD', '/api/admin/users')).toBe(false);
  });

  it('takes a staff power exercised through a member-facing path', () => {
    // The console prefixes are not the whole story: a moderator deletes a
    // torrent, a comment or a forum post through the ordinary member routes,
    // and every one of those is an act of authority that left no row.
    expect(isAuditable('DELETE', '/api/torrents/abc', true)).toBe(true);
    expect(isAuditable('DELETE', '/api/torrents/comments/12', true)).toBe(true);
    expect(isAuditable('PATCH', '/api/forum/posts/9', true)).toBe(true);
    expect(isAuditable('DELETE', '/api/messaging/room/messages/7', true)).toBe(true);
    // …and the same request from a member is still nobody's business.
    expect(isAuditable('DELETE', '/api/torrents/abc', false)).toBe(false);
    expect(isAuditable('PATCH', '/api/forum/posts/9', false)).toBe(false);
  });

  it('ignores member-facing mutations', () => {
    // Logging these would turn the register into a record of everybody's
    // activity — the opposite of what the privacy toggles elsewhere protect.
    expect(isAuditable('POST', '/api/torrents')).toBe(false);
    expect(isAuditable('PATCH', '/api/me')).toBe(false);
    expect(isAuditable('DELETE', '/api/me')).toBe(false);
    expect(isAuditable('POST', '/api/messaging/conversations')).toBe(false);
  });

  it('is not fooled by a path that merely contains the prefix', () => {
    expect(isAuditable('POST', '/api/torrents/admin/x')).toBe(false);
    // No trailing slash: `/api/admin` itself is not a route, and matching it
    // would be matching a prefix rather than a console.
    expect(isAuditable('POST', '/api/administrators')).toBe(false);
  });
});

describe('deriveAction', () => {
  it('names the operation from the path, dropping identifiers', () => {
    expect(
      deriveAction('POST', '/api/admin/users/3f2b1c4d-1111-2222-3333-444455556666/ban')
    ).toBe('admin.users.ban');
    expect(deriveAction('PUT', '/api/admin/settings')).toBe('admin.settings.update');
    expect(deriveAction('DELETE', '/api/admin/tags/42')).toBe('admin.tags.delete');
  });

  it('drops a 40-hex infohash the same way', () => {
    // Otherwise every torrent is its own action and the filter is useless.
    expect(deriveAction('PUT', `/api/mod/torrents/${'a'.repeat(40)}/approve`)).toBe(
      'mod.torrents.approve'
    );
  });

  it('does not append a verb to a segment that is already one', () => {
    // `admin.users.ban.create` reads worse than `admin.users.ban`.
    expect(
      deriveAction('POST', '/api/admin/users/3f2b1c4d-1111-2222-3333-444455556666/unban')
    ).toBe('admin.users.unban');
    expect(deriveAction('POST', '/api/admin/panic/encrypt')).toBe(
      'admin.panic.encrypt.create'
    );
  });

  it('keeps slug-shaped segments — they name things', () => {
    expect(deriveAction('PUT', '/api/admin/federation/peers')).toBe(
      'admin.federation.peers.update'
    );
  });

  it('falls back rather than producing an empty key', () => {
    expect(deriveAction('POST', '/api/')).toBe('unknown.create');
    expect(deriveAction('POST', '')).toBe('unknown.create');
  });

  it('passes an unusual method through rather than guessing', () => {
    expect(deriveAction('LOCK', '/api/admin/settings')).toBe('admin.settings.lock');
  });
});

describe('deriveAction with route params', () => {
  it('removes a slug-shaped id that shape heuristics cannot spot', () => {
    // The case an end-to-end run found: a peer id that looks like a
    // sub-resource name, turning every peer into its own action category.
    expect(
      deriveAction(
        'DELETE',
        '/api/admin/federation/peers/does-not-exist',
        ['does-not-exist']
      )
    ).toBe('admin.federation.peers.delete');
  });

  it('removes several parameters at once', () => {
    expect(
      deriveAction('DELETE', '/api/admin/users/alice/roles/uploader', [
        'alice',
        'uploader',
      ])
    ).toBe('admin.users.roles.delete');
  });

  it('leaves a genuine path segment that happens to equal no parameter', () => {
    expect(deriveAction('POST', '/api/admin/panic/encrypt', [])).toBe(
      'admin.panic.encrypt.create'
    );
  });

  it('ignores empty parameter values rather than stripping empty segments', () => {
    expect(deriveAction('PUT', '/api/admin/settings', [''])).toBe(
      'admin.settings.update'
    );
  });
});
