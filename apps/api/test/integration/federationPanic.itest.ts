import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { federationSuspended } from '../../utils/federation/config';
import { redis } from '../../utils/server';
import { invalidatePanicCache } from '../../utils/panicLock';

// Panic mode must stop federation. It encrypts the catalogue in place, and the
// whole point is to stop exfiltration during an incident — yet nothing in the
// federation path consulted the flag. The mint loop kept marching the cursor
// over the panic-bumped `updated_at` and republishing an encrypted record per
// torrent; the S2S endpoints kept serving. `federationSuspended()` is the one
// gate that now sits in front of the loops and the serving surface.

async function setPanic(
  on: boolean,
  phase: 'idle' | 'encrypting' | 'encrypted' | 'restoring' = on ? 'encrypted' : 'idle',
): Promise<void> {
  await db
    .insert(schema.panicState)
    .values({ id: 'singleton', isEncrypted: on, phase })
    .onConflictDoUpdate({ target: schema.panicState.id, set: { isEncrypted: on, phase } });
  // The gate caches through Redis; clear it so the test reads the new state.
  // Best-effort: if Redis is briefly unavailable the gate itself falls back to
  // the database, which is the property under test.
  await invalidatePanicCache();
}

describe('federation while the instance is in panic', () => {
  beforeAll(async () => {
    // The Redis client connects lazily; wait for it so the cache clear in
    // setPanic is reliable rather than racing the first connection.
    for (let i = 0; i < 50; i++) {
      try {
        await redis.ping();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });

  beforeEach(async () => {
    await setPanic(false);
  });

  it('reports suspended when the catalogue is encrypted', async () => {
    expect(await federationSuspended()).toBe(false);
    await setPanic(true);
    expect(await federationSuspended()).toBe(true);
  });

  it('reports running again once panic is lifted', async () => {
    await setPanic(true);
    expect(await federationSuspended()).toBe(true);
    await setPanic(false);
    expect(await federationSuspended()).toBe(false);
  });

  it('falls back to the database rather than failing open on a cache miss', async () => {
    // A stale or missing cache must never read as "not in panic" — panic is
    // exactly when a cache miss is most likely and most dangerous.
    await setPanic(true);
    await invalidatePanicCache();
    expect(await federationSuspended()).toBe(true);
  });

  it('is suspended from the first encrypted row, not only once the flag is set', async () => {
    // `is_encrypted` stays false for the whole encrypt pass — and an interrupted
    // pass can stay there — while the mint loop would publish what it already
    // encrypted. Same for a restore that stopped half way.
    await setPanic(false, 'encrypting');
    expect(await federationSuspended()).toBe(true);
    await setPanic(true, 'restoring');
    expect(await federationSuspended()).toBe(true);
  });
});
