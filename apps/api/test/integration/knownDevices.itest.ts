import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { redis } from '../../utils/server';
import {
  encodeKnownDevice,
  knownDeviceFor,
  recordKnownDeviceFailure,
} from '../../utils/knownDevices';
import { makeUser } from './helpers';

// A known-device cookie exempts a browser from the per-account sign-in lockout.
// What makes it safe to hand out is checked here against the real account row
// and Redis: it names one account, dies with "sign out everywhere" and with a
// password change, and a device that keeps failing loses it for good.

const VERIFIER = 'v1:cipher-a';
const now = () => Math.floor(Date.now() / 1000);
const newDevice = () => randomBytes(16).toString('base64url');

async function member(): Promise<{ id: string; username: string }> {
  const id = await makeUser({ sessionEpoch: 0, authVerifier: VERIFIER });
  const row = await db.query.users.findFirst({
    where: eq(schema.users.id, id),
    columns: { username: true },
  });
  return { id, username: row!.username };
}

const cookieFor = (userId: string, device: string) =>
  encodeKnownDevice({ userId, sessionEpoch: 0, authVerifier: VERIFIER }, device, now());

describe('known devices', () => {
  it('recognises a cookie for the account it was issued to, under that username only', async () => {
    const a = await member();
    const b = await member();
    const device = newDevice();
    const value = cookieFor(a.id, device);

    expect(await knownDeviceFor(value, a.username)).toBe(device);
    expect(await knownDeviceFor(value, b.username)).toBeNull();
    expect(await knownDeviceFor(value, 'no-such-member-anywhere')).toBeNull();
    expect(await knownDeviceFor(undefined, a.username)).toBeNull();
  });

  it('forgets the browser when the account signs out everywhere or changes password', async () => {
    const a = await member();
    const device = newDevice();
    const value = cookieFor(a.id, device);
    expect(await knownDeviceFor(value, a.username)).toBe(device);

    // What "sign out everywhere" and a ban do.
    await db.update(schema.users).set({ sessionEpoch: 1 }).where(eq(schema.users.id, a.id));
    expect(await knownDeviceFor(value, a.username)).toBeNull();

    // What a password change does to the stored verifier.
    await db
      .update(schema.users)
      .set({ sessionEpoch: 0, authVerifier: 'v1:cipher-b' })
      .where(eq(schema.users.id, a.id));
    expect(await knownDeviceFor(value, a.username)).toBeNull();
  });

  it('revokes a device after ten failures in the window, and only that device', async () => {
    const a = await member();
    const noisy = newDevice();
    const quiet = newDevice();

    for (let i = 0; i < 9; i++) await recordKnownDeviceFailure(noisy);
    expect(await knownDeviceFor(cookieFor(a.id, noisy), a.username)).toBe(noisy);
    await recordKnownDeviceFailure(noisy);
    expect(await knownDeviceFor(cookieFor(a.id, noisy), a.username)).toBeNull();
    // Re-signed or not, the id stays revoked: the cookie's age is not what failed.
    expect(await knownDeviceFor(cookieFor(a.id, noisy), a.username)).toBeNull();
    expect(await knownDeviceFor(cookieFor(a.id, quiet), a.username)).toBe(quiet);

    await redis.del(`known-device:revoked:${noisy}`, `ratelimit:signin-fail-device:${noisy}`);
  });

  it('does not count failures older than the window', async () => {
    const a = await member();
    const device = newDevice();
    const old = Date.now() - 16 * 60 * 1000;
    for (let i = 0; i < 9; i++) {
      await redis.zadd(`ratelimit:signin-fail-device:${device}`, old + i, `old-${i}`);
    }
    await recordKnownDeviceFailure(device); // the tenth entry, nine of them stale
    expect(await knownDeviceFor(cookieFor(a.id, device), a.username)).toBe(device);

    await redis.del(`ratelimit:signin-fail-device:${device}`);
  });
});
