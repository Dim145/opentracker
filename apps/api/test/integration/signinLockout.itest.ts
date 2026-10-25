import { describe, it, expect, beforeEach } from 'vitest';
import { redis } from '../../utils/server';
import {
  assertAccountNotLocked,
  recordAccountFailure,
  clearAccountFailures,
} from '../../utils/rateLimit';

// Failed sign-ins counted per username, so a guesser spread over many addresses
// still meets a limit. Every username counts, existing or not: a lockout must
// never be how somebody learns that an account exists.

const locked = async (u: string) =>
  assertAccountNotLocked(u).then(
    () => false,
    (err: { statusCode?: number }) => {
      if (err.statusCode !== 429) throw err;
      return true;
    },
  );

describe('per-account sign-in lockout', () => {
  beforeEach(async () => {
    for (const u of ['alice', 'nobody-at-all', 'bob']) await clearAccountFailures(u);
  });

  it('locks a username after ten failures in the window', async () => {
    for (let i = 0; i < 9; i++) await recordAccountFailure('alice');
    expect(await locked('alice')).toBe(false);
    await recordAccountFailure('alice');
    expect(await locked('alice')).toBe(true);
    // Case does not open a second counter.
    expect(await locked('ALICE')).toBe(true);
    // Another account is untouched.
    expect(await locked('bob')).toBe(false);
  });

  it('counts a username that has no account the same way', async () => {
    for (let i = 0; i < 10; i++) await recordAccountFailure('nobody-at-all');
    expect(await locked('nobody-at-all')).toBe(true);
  });

  it('forgets failures older than the window, and on a successful sign-in', async () => {
    for (let i = 0; i < 10; i++) await recordAccountFailure('alice');
    expect(await locked('alice')).toBe(true);
    await clearAccountFailures('alice');
    expect(await locked('alice')).toBe(false);

    // Ten failures stamped sixteen minutes ago no longer count.
    const old = Date.now() - 16 * 60 * 1000;
    for (let i = 0; i < 10; i++) {
      await redis.zadd('ratelimit:signin-fail:alice', old + i, `old-${i}`);
    }
    expect(await locked('alice')).toBe(false);
  });
});
