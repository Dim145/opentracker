import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { creditPoints, creditDailyLoginIfDue } from '../../utils/bonusEarning';
import { redis } from '../../redis/client';
import { getBonus, makeUser } from './helpers';

// Crediting bonus points, against a real Postgres.
//
// This is currency: points are spent in the shop, fund the freeleech pool and
// act as the stake on the bounty board. Two invariants matter more than the
// rest, and neither can be checked without a database.
//
//   * the balance and the ledger cannot diverge — they are written in the same
//     transaction, so a partial failure must roll everything back;
//   * the daily credit cannot be claimed twice on the same day, not even by
//     two simultaneous requests.
//
// The second is the only one already exploited elsewhere: a double click is
// enough to trigger it when the guard is not atomic.

async function grantCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.bonusGrants)
    .where(eq(schema.bonusGrants.userId, userId));
  return row!.n;
}

describe('creditPoints — balance and ledger move together', () => {
  it('credits the balance and writes a ledger row', async () => {
    const user = await makeUser({ bonusPoints: 0 });
    await creditPoints({ userId: user, source: 'seeding', amount: 42 });

    expect(await getBonus(user)).toBe(42);
    expect(await grantCount(user)).toBe(1);

    const [grant] = await db
      .select()
      .from(schema.bonusGrants)
      .where(eq(schema.bonusGrants.userId, user));
    expect(grant!.amount).toBe(42);
    expect(grant!.source).toBe('seeding');
  });

  it('accumulates rather than overwrites', async () => {
    const user = await makeUser({ bonusPoints: 10 });
    await creditPoints({ userId: user, source: 'seeding', amount: 5 });
    await creditPoints({ userId: user, source: 'first_seeder', amount: 25 });

    expect(await getBonus(user)).toBe(40);
    expect(await grantCount(user)).toBe(2);
  });

  it('ignores a zero or negative amount without writing anything', async () => {
    // A negative credit would be a debit in disguise, outside every balance
    // guard; refusing it up front beats catching it afterwards.
    const user = await makeUser({ bonusPoints: 100 });
    await creditPoints({ userId: user, source: 'seeding', amount: 0 });
    await creditPoints({ userId: user, source: 'seeding', amount: -50 });

    expect(await getBonus(user)).toBe(100);
    expect(await grantCount(user)).toBe(0);
  });

  it('writes neither balance nor ledger when the user does not exist', async () => {
    // The UPDATE touches no row; the ledger INSERT must then fail on the
    // foreign key and roll the whole transaction back. Without a transaction
    // we would be left with an orphaned ledger row.
    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.bonusGrants);
    await expect(
      creditPoints({
        userId: '00000000-0000-0000-0000-000000000000',
        source: 'seeding',
        amount: 10,
      }),
    ).rejects.toThrow();
    const after = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.bonusGrants);
    expect(after[0]!.n).toBe(before[0]!.n);
  });

  it('handles concurrent credits without losing any', async () => {
    // `bonus_points = bonus_points + x` is atomic on the Postgres side; this
    // test pins that choice, because moving to a read-then-write in the
    // application would lose credits under load and be invisible to the eye.
    const user = await makeUser({ bonusPoints: 0 });
    await Promise.all(
      Array.from({ length: 20 }, () =>
        creditPoints({ userId: user, source: 'seeding', amount: 3 }),
      ),
    );
    expect(await getBonus(user)).toBe(60);
    expect(await grantCount(user)).toBe(20);
  });
});

describe('creditDailyLoginIfDue — once a day, not twice', () => {
  const REWARD = 5;

  beforeEach(async () => {
    // The rule lives in the database and is only seeded on the API's first
    // boot; the TRUNCATE in `setup.ts` does not recreate it, so put it back
    // here.
    await db
      .insert(schema.bonusRules)
      .values({
        id: randomUUID(),
        kind: 'daily_login',
        enabled: true,
        config: { reward: REWARD },
      })
      .onConflictDoNothing();
    // The idempotence guard is a Redis key with a 36 h TTL: without a purge,
    // the day's second test would inherit the first one's key.
    const keys = await redis.keys('bonus:dailyLogin:*');
    if (keys.length) await redis.del(...keys);
  });

  it('credits on the first call', async () => {
    const user = await makeUser({ bonusPoints: 0 });
    const credited = await creditDailyLoginIfDue(user);
    expect(credited).toBeGreaterThan(0);
    expect(await getBonus(user)).toBe(credited);
  });

  it('does not credit again on the same day', async () => {
    const user = await makeUser({ bonusPoints: 0 });
    const first = await creditDailyLoginIfDue(user);
    const second = await creditDailyLoginIfDue(user);

    expect(second).toBe(0);
    expect(await getBonus(user)).toBe(first);
  });

  it('withstands two simultaneous claims', async () => {
    // The double-click case, or two tabs. If the guard were only a SELECT
    // followed by an INSERT, both would get through.
    const user = await makeUser({ bonusPoints: 0 });
    const [a, b] = await Promise.all([
      creditDailyLoginIfDue(user),
      creditDailyLoginIfDue(user),
    ]);

    // Exactly one of the two credits.
    expect([a, b].filter((n) => n > 0)).toHaveLength(1);
    expect(await getBonus(user)).toBe(Math.max(a, b));
    expect(await grantCount(user)).toBe(1);
  });

  it('does not mix accounts up', async () => {
    const a = await makeUser({ bonusPoints: 0 });
    const b = await makeUser({ bonusPoints: 0 });
    await creditDailyLoginIfDue(a);
    expect(await getBonus(b)).toBe(0);
    expect(await grantCount(b)).toBe(0);
  });
});
