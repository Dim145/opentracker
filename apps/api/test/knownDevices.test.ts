import { describe, it, expect, afterEach } from 'vitest';
import {
  encodeKnownDevice,
  verifyKnownDevice,
  KNOWN_DEVICE_TTL_S,
} from '../utils/knownDevices';

// The known-device cookie exempts a browser from the per-account sign-in
// lockout, so everything it is bound to must void it when it changes: the
// account, the session epoch ("sign out everywhere", a ban), the stored
// verifier (a password change). And nothing about it may be forged or stretched.

const subject = {
  userId: 'a8e2c0de-0000-4000-8000-000000000001',
  sessionEpoch: 3,
  authVerifier: 'v1:cipher',
};
const DEVICE = 'AAAAAAAAAAAAAAAAAAAAAA'; // 22 base64url characters, as issued
const NOW = 1_800_000_000;

describe('known-device cookie', () => {
  const originalSecret = process.env.NUXT_SESSION_SECRET;
  afterEach(() => {
    process.env.NUXT_SESSION_SECRET = originalSecret;
  });

  it('round-trips to its device id', () => {
    const value = encodeKnownDevice(subject, DEVICE, NOW);
    expect(value).toMatch(/^v1\.[A-Za-z0-9_-]{22}\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(verifyKnownDevice(value, subject, NOW)).toBe(DEVICE);
  });

  it('is void for another account, epoch or credential', () => {
    const value = encodeKnownDevice(subject, DEVICE, NOW);
    const other = 'a8e2c0de-0000-4000-8000-000000000002';
    expect(verifyKnownDevice(value, { ...subject, userId: other }, NOW)).toBeNull();
    expect(verifyKnownDevice(value, { ...subject, sessionEpoch: 4 }, NOW)).toBeNull();
    expect(verifyKnownDevice(value, { ...subject, authVerifier: 'v1:other' }, NOW)).toBeNull();
  });

  it('reads a missing epoch as 0, the way sessions do', () => {
    const value = encodeKnownDevice({ ...subject, sessionEpoch: null }, DEVICE, NOW);
    expect(verifyKnownDevice(value, { ...subject, sessionEpoch: 0 }, NOW)).toBe(DEVICE);
  });

  it('refuses any part edited', () => {
    const value = encodeKnownDevice(subject, DEVICE, NOW);
    const [v, device, issued, mac] = value.split('.') as [string, string, string, string];
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    expect(verifyKnownDevice([v, flip(device), issued, mac].join('.'), subject, NOW)).toBeNull();
    expect(verifyKnownDevice([v, device, String(Number(issued) + 1), mac].join('.'), subject, NOW)).toBeNull();
    expect(verifyKnownDevice([v, device, issued, flip(mac)].join('.'), subject, NOW)).toBeNull();
    expect(verifyKnownDevice(['v2', device, issued, mac].join('.'), subject, NOW)).toBeNull();
  });

  it('expires, and takes no issue time from the future beyond clock skew', () => {
    const at = (issuedAt: number) => encodeKnownDevice(subject, DEVICE, issuedAt);
    expect(verifyKnownDevice(at(NOW - KNOWN_DEVICE_TTL_S), subject, NOW)).toBe(DEVICE);
    expect(verifyKnownDevice(at(NOW - KNOWN_DEVICE_TTL_S - 1), subject, NOW)).toBeNull();
    expect(verifyKnownDevice(at(NOW + 299), subject, NOW)).toBe(DEVICE);
    expect(verifyKnownDevice(at(NOW + 301), subject, NOW)).toBeNull();
  });

  it('rejects anything that is not the issued shape', () => {
    const mac = 'A'.repeat(43);
    for (const bad of [
      undefined,
      null,
      '',
      'v1',
      'v1..1.x',
      `v1.${DEVICE}.1`,
      `v1.${DEVICE}.1.x.y`,
      `v1.${DEVICE.slice(1)}.1.${mac}`, // device id one character short
      `v1.${DEVICE}.-1.${mac}`,
      `v1.${DEVICE}.1.${mac.slice(1)}=`, // padding is not base64url
    ]) {
      expect(verifyKnownDevice(bad, subject, NOW)).toBeNull();
    }
  });

  it('dies with the session secret', () => {
    const value = encodeKnownDevice(subject, DEVICE, NOW);
    process.env.NUXT_SESSION_SECRET = 'another-session-secret-0123456789abcdef';
    expect(verifyKnownDevice(value, subject, NOW)).toBeNull();
  });
});
