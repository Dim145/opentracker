import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  POOL_CONFIG_ID,
  contribute,
  getConfig,
  getCurrentCycle,
  getUserContribution,
  getTopContributors,
  FreeleechPoolError,
} from '../../utils/freeleechPool';
import { getBonus, makeUser } from './helpers';

// Freeleech pool — the shared purse.
//
// Every contribution is a real debit from a member's balance, and the pot is
// shared: two invariants pull against each other constantly. On one side, a
// contribution must never credit the pot without debiting its author (nor the
// reverse). On the other, the per-person cap must hold even when several
// contributions land at the same time — which is exactly the scenario a
// read-then-write check lets through.
//
// `contribute` takes an advisory lock on the pot before writing; these tests
// pin what that lock guarantees.

const TARGET = 1000;

async function setConfig(over: Record<string, unknown> = {}): Promise<void> {
  await db
    .insert(schema.freeleechPoolConfig)
    .values({
      id: POOL_CONFIG_ID,
      enabled: true,
      pointsTarget: TARGET,
      contributionMin: 10,
      ...over,
    })
    .onConflictDoUpdate({
      target: schema.freeleechPoolConfig.id,
      set: { enabled: true, pointsTarget: TARGET, contributionMin: 10, ...over },
    });
}

async function potTotal(): Promise<number> {
  const cycle = await getCurrentCycle();
  return cycle?.totalContributed ?? 0;
}

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE freeleech_pool_windows, freeleech_pool_config RESTART IDENTITY CASCADE`,
  );
  await setConfig();
});

describe('contribute — pot and balance move together', () => {
  it('debits the author and credits the pot by the same amount', async () => {
    const user = await makeUser({ bonusPoints: 500 });
    await contribute(user, 100);

    expect(await getBonus(user)).toBe(400);
    expect(await potTotal()).toBe(100);
    expect(await getUserContribution((await getCurrentCycle())!.id, user)).toBe(100);
  });

  it('accumulates successive contributions from the same member', async () => {
    const user = await makeUser({ bonusPoints: 500 });
    await contribute(user, 50);
    await contribute(user, 30);

    expect(await getBonus(user)).toBe(420);
    expect(await potTotal()).toBe(80);
    expect(await getUserContribution((await getCurrentCycle())!.id, user)).toBe(80);
  });

  it('adds up contributions from several members', async () => {
    const a = await makeUser({ bonusPoints: 500 });
    const b = await makeUser({ bonusPoints: 500 });
    await contribute(a, 100);
    await contribute(b, 250);

    expect(await potTotal()).toBe(350);
    expect(await getBonus(a)).toBe(400);
    expect(await getBonus(b)).toBe(250);
  });

  it('refuses to overdraw a balance, and touches nothing', async () => {
    const user = await makeUser({ bonusPoints: 40 });
    await expect(contribute(user, 100)).rejects.toThrow();

    expect(await getBonus(user)).toBe(40);
    expect(await potTotal()).toBe(0);
  });
});

describe('contribute — input guards', () => {
  it('refuses a non-integer, zero or negative amount', async () => {
    const user = await makeUser({ bonusPoints: 500 });
    for (const bad of [0, -10, 1.5, Number.NaN]) {
      await expect(contribute(user, bad)).rejects.toBeInstanceOf(FreeleechPoolError);
    }
    expect(await getBonus(user)).toBe(500);
  });

  it('refuses anything below the configured minimum', async () => {
    const user = await makeUser({ bonusPoints: 500 });
    await expect(contribute(user, 9)).rejects.toThrow(/[Mm]inimum/);
    await expect(contribute(user, 10)).resolves.toBeDefined();
  });

  it('refuses while the pot is disabled', async () => {
    await setConfig({ enabled: false });
    const user = await makeUser({ bonusPoints: 500 });
    await expect(contribute(user, 100)).rejects.toThrow(/disabled/i);
  });

  it('refuses when no target is configured', async () => {
    await setConfig({ pointsTarget: 0 });
    const user = await makeUser({ bonusPoints: 500 });
    await expect(contribute(user, 100)).rejects.toThrow(/target/i);
  });
});

describe('contribute — concurrency', () => {
  it('never takes in more than the balance under simultaneous contributions', async () => {
    // The case that matters: ten requests of 100 against a balance of 250.
    // Without the lock several of them would read the same balance and the pot
    // would receive more than the member owns — money created out of nothing.
    const user = await makeUser({ bonusPoints: 250 });
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => contribute(user, 100)),
    );

    const succeeded = attempts.filter((r) => r.status === 'fulfilled').length;
    expect(succeeded).toBe(2); // 250 only funds two lots of 100
    expect(await getBonus(user)).toBe(50);
    expect(await potTotal()).toBe(200);
  });

  it('keeps the pot equal to the sum of the recorded contributions', async () => {
    // Consistency invariant: the cycle's denormalised counter must never drift
    // from the detail rows, even after a burst.
    const members = await Promise.all(
      Array.from({ length: 6 }, () => makeUser({ bonusPoints: 500 })),
    );
    await Promise.allSettled(members.map((m) => contribute(m, 50)));

    const cycle = await getCurrentCycle();
    const [sum] = await db
      .select({ total: sql<number>`coalesce(sum(amount), 0)::int` })
      .from(schema.freeleechPoolContributions)
      .where(eq(schema.freeleechPoolContributions.cycleId, cycle!.id));

    expect(cycle!.totalContributed).toBe(sum!.total);
  });
});

describe('per-person cap', () => {
  it('stops one person from carrying the whole pot', async () => {
    // `maxPerUserBp` is in basis points: 2500 = 25% of the target.
    await setConfig({ maxPerUserBp: 2500 });
    const user = await makeUser({ bonusPoints: 5000 });

    await contribute(user, 250); // exactly the cap
    await expect(contribute(user, 10)).rejects.toThrow();

    expect(await getUserContribution((await getCurrentCycle())!.id, user)).toBe(250);
  });

  it('holds under simultaneous contributions', async () => {
    await setConfig({ maxPerUserBp: 2500 });
    const user = await makeUser({ bonusPoints: 5000 });

    await Promise.allSettled(
      Array.from({ length: 8 }, () => contribute(user, 100)),
    );

    const total = await getUserContribution((await getCurrentCycle())!.id, user);
    expect(total).toBeLessThanOrEqual(250);
  });
});

describe('contributor leaderboard', () => {
  it('ranks by descending amount', async () => {
    const small = await makeUser({ bonusPoints: 500 });
    const large = await makeUser({ bonusPoints: 500 });
    const middle = await makeUser({ bonusPoints: 500 });
    await contribute(small, 20);
    await contribute(large, 200);
    await contribute(middle, 80);

    const cycle = await getCurrentCycle();
    const top = await getTopContributors(cycle!.id, 10);
    expect(top.map((t) => t.total)).toEqual([200, 80, 20]);
  });

  it('aggregates one person’s several contributions into a single row', async () => {
    const user = await makeUser({ bonusPoints: 500 });
    await contribute(user, 40);
    await contribute(user, 60);

    const cycle = await getCurrentCycle();
    const top = await getTopContributors(cycle!.id, 10);
    expect(top).toHaveLength(1);
    expect(top[0]!.total).toBe(100);
  });
});

describe('configuration', () => {
  it('creates a default configuration rather than failing', async () => {
    await db.execute(sql`TRUNCATE TABLE freeleech_pool_config CASCADE`);
    const cfg = await getConfig();
    expect(cfg.id).toBe(POOL_CONFIG_ID);
    expect(typeof cfg.pointsTarget).toBe('number');
  });
});
