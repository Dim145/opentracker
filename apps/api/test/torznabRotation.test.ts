import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

/**
 * A Torznab access block is stored under a hash of the member's passkey, so
 * every route that rotates that passkey has to move the block onto the
 * replacement. One of them did not, and the effect was that a blocked member
 * could lift an administrator's restriction from their own settings page.
 *
 * Nothing about a rotation route makes that requirement visible while writing
 * it — the block lives in Redis, under a key the route never mentions — which
 * is exactly why this is a structural test over the source rather than a unit
 * test of one function. It fails on the fourth rotation path, the one nobody
 * has written yet.
 */

const ROUTES = join(import.meta.dirname, '..', 'routes');

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.ts')) yield full;
  }
}

/**
 * Every route file that gives `users.passkey` a different value — matched on
 * the drizzle write, `.set({ passkey: … })`, whatever the variable holding it
 * is called.
 *
 * Panic mode is the one exclusion, and it is not an exception to the rule: it
 * encrypts the stored passkey of every account and decrypts it back, so the
 * member's credential never changes. The block index moves out from under the
 * entry while the site is sealed — where no feed works for anybody — and comes
 * back with it. Writing a block under the ciphertext's hash would be actively
 * wrong.
 *
 * The predicate is deliberately the wide one: anything that writes the column
 * by some route this test has never seen lands in the list and has to say what
 * it does about the block.
 */
async function rotationRoutes(): Promise<{ path: string; source: string }[]> {
  const found: { path: string; source: string }[] = [];
  for await (const path of walk(ROUTES)) {
    const source = await readFile(path, 'utf8');
    if (!/\.set\(\{[^}]*\bpasskey:/s.test(source)) continue;
    if (/encryptField|decryptField/.test(source)) continue;
    found.push({ path: path.slice(ROUTES.length + 1), source });
  }
  return found;
}

describe('passkey rotation carries the Torznab block', () => {
  it('finds the rotation routes at all', async () => {
    const routes = await rotationRoutes();
    // If this drops to zero the test has stopped testing anything — a renamed
    // column or a switch away from `.set({ passkey })` would make every
    // assertion below vacuously true.
    expect(routes.map((r) => r.path).sort()).toEqual([
      'api/admin/torznab/users/[id]/reset.post.ts',
      'api/auth/passkey.post.ts',
      'api/me/passkey/reset.post.ts',
    ]);
  });

  it('every rotation route carries the block onto the new passkey', async () => {
    const missing = (await rotationRoutes())
      // The open paren matters: an unused import satisfies a plain name
      // match, which is precisely the state a half-applied fix leaves behind.
      .filter((r) => !r.source.includes('carryTorznabBlock('))
      .map((r) => r.path);
    expect(missing).toEqual([]);
  });

  it('and retires the old one', async () => {
    const missing = (await rotationRoutes())
      .filter((r) => !r.source.includes('retireTorznabPasskey('))
      .map((r) => r.path);
    expect(missing).toEqual([]);
  });

  it('carries before it writes, and retires after', async () => {
    // Order is the whole guarantee: carry first and there is no instant in
    // which a live passkey is unblocked. A route that retired the old entry
    // before the row changed would open exactly the window this closes.
    for (const { path, source } of await rotationRoutes()) {
      const carry = source.indexOf('carryTorznabBlock(');
      const write = source.search(/\.set\(\{[^}]*\bpasskey:/s);
      const retire = source.indexOf('retireTorznabPasskey(');
      // Assert they are there before comparing positions: `indexOf` answers
      // -1 for absent, and -1 is less than every offset in the file, so the
      // ordering check would pass loudest on the route that does neither.
      expect(carry, `${path}: calls carryTorznabBlock`).toBeGreaterThan(-1);
      expect(retire, `${path}: calls retireTorznabPasskey`).toBeGreaterThan(-1);
      expect(carry, `${path}: carry before the write`).toBeLessThan(write);
      expect(retire, `${path}: retire after the write`).toBeGreaterThan(write);
    }
  });
});
