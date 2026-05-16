/**
 * Point movements for the upload-request bounty board.
 *
 * Three primitives, all atomic inside a Postgres transaction with
 * `FOR UPDATE` locks on the user rows so a concurrent shop purchase
 * or another reward credit can't see a stale balance:
 *
 *   ▸ holdReward(userId, amount, tx)
 *       Deducts `amount` from the user's `bonus_points`. Used at
 *       request creation and at every upward bump of the reward.
 *       Throws if the balance is short — callers should surface
 *       a 400 rather than try to recover.
 *
 *   ▸ refundReward(userId, amount, tx)
 *       Credits `amount` back. Used on cancel, and on the requester
 *       side if a future flow ever supports partial refunds.
 *
 *   ▸ payReward(fillerId, amount, tx)
 *       Credits `amount` to the filler. Used on validate and
 *       auto-validate. Functionally identical to `refundReward`
 *       but kept as a distinct symbol so audit log filtering /
 *       grep'ing reads cleanly.
 *
 * No `bonus_grants` ledger row: those rows are reserved for the
 * earned-bonus rules (seeding, milestones, …). The bounty board has
 * its own audit trail via the request row itself + the fill_attempts
 * table, so a duplicate grants row would be noise.
 */
import { sql } from 'drizzle-orm';
import type { db } from '@trackarr/db';
import { schema } from '@trackarr/db';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class RewardError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'RewardError';
  }
}

async function lockUser(tx: Tx, userId: string): Promise<number> {
  const rows = await tx.execute<{ bonus_points: number }>(
    sql`SELECT bonus_points FROM ${schema.users} WHERE id = ${userId} FOR UPDATE`,
  );
  if (rows.length === 0) {
    throw new RewardError(404, 'User not found');
  }
  return Number(rows[0]!.bonus_points);
}

export async function holdReward(
  tx: Tx,
  userId: string,
  amount: number,
): Promise<number> {
  if (amount <= 0) return 0;
  const balance = await lockUser(tx, userId);
  if (balance < amount) {
    throw new RewardError(
      400,
      `Insufficient bonus points (need ${amount}, have ${balance})`,
    );
  }
  await tx.execute(
    sql`UPDATE ${schema.users} SET bonus_points = bonus_points - ${amount} WHERE id = ${userId}`,
  );
  return balance - amount;
}

export async function refundReward(
  tx: Tx,
  userId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await lockUser(tx, userId);
  await tx.execute(
    sql`UPDATE ${schema.users} SET bonus_points = bonus_points + ${amount} WHERE id = ${userId}`,
  );
}

export async function payReward(
  tx: Tx,
  fillerId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await lockUser(tx, fillerId);
  await tx.execute(
    sql`UPDATE ${schema.users} SET bonus_points = bonus_points + ${amount} WHERE id = ${fillerId}`,
  );
}
