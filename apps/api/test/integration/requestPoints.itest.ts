import { describe, it, expect } from 'vitest';
import { db } from '@trackarr/db';
import {
  holdReward,
  payReward,
  refundReward,
  RewardError,
} from '../../utils/requestPoints';
import { makeUser, getBonus } from './helpers';

// Faithful integration test: exercises the REAL requestPoints helpers
// (the bounty-board point primitives) against a real Postgres, including
// the FOR UPDATE serialization that underpins the economy's integrity.

describe('requestPoints (real code, real Postgres)', () => {
  it('holdReward debits the balance', async () => {
    const u = await makeUser({ bonusPoints: 100 });
    const remaining = await db.transaction((tx) => holdReward(tx, u, 30));
    expect(remaining).toBe(70);
    expect(await getBonus(u)).toBe(70);
  });

  it('holdReward refuses to overdraw and rolls back', async () => {
    const u = await makeUser({ bonusPoints: 10 });
    await expect(
      db.transaction((tx) => holdReward(tx, u, 60)),
    ).rejects.toBeInstanceOf(RewardError);
    expect(await getBonus(u)).toBe(10); // unchanged
  });

  it('payReward and refundReward credit the balance', async () => {
    const u = await makeUser({ bonusPoints: 0 });
    await db.transaction((tx) => payReward(tx, u, 25));
    expect(await getBonus(u)).toBe(25);
    await db.transaction((tx) => refundReward(tx, u, 5));
    expect(await getBonus(u)).toBe(30);
  });

  it('concurrent holdReward cannot overdraft (FOR UPDATE serializes)', async () => {
    const u = await makeUser({ bonusPoints: 100 });
    // Two simultaneous 60-point holds against a 100-point balance. The
    // per-user FOR UPDATE lock must serialize them so the second re-reads
    // the post-commit balance (40), sees it is short, and throws — rather
    // than both reading 100 and driving the balance to -20.
    const results = await Promise.allSettled([
      db.transaction((tx) => holdReward(tx, u, 60)),
      db.transaction((tx) => holdReward(tx, u, 60)),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      RewardError,
    );
    expect(await getBonus(u)).toBe(40); // exactly one debit applied
  });
});
