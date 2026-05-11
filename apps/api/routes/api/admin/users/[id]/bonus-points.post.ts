/**
 * POST /api/admin/users/:id/bonus-points
 *
 * Admin-only endpoint to grant or revoke bonus points on a user's
 * balance. Body: `{ delta: number, note?: string }`. Positive delta
 * adds, negative subtracts. The current balance is locked + clamped
 * to ≥ 0 so an admin can't drag it negative by accident.
 *
 * Audit: every adjustment writes a row to `bonus_grants` with
 * `source = 'admin_adjust'` and metadata { actorId, note } — the
 * standard ledger surfaces these alongside the cron-driven grants
 * in the per-user history view.
 *
 * Hierarchy: any admin can adjust any user (including other admins
 * and moderators). Moderators are intentionally left out — bonus
 * tuning is a coarse policy lever, not a moderation tool.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { requireAdminSession } from '~~/utils/adminAuth';
import { notify } from '~~/utils/notify';

const bodySchema = z
  .object({
    /** Whole points to add (positive) or remove (negative). Capped at
     *  ±10M to keep typos from becoming irreversible economy events. */
    delta: z
      .number()
      .int()
      .refine((n) => n !== 0, 'Delta must be non-zero')
      .refine((n) => Math.abs(n) <= 10_000_000, 'Delta must be ≤ 10M'),
    /** Optional reason — recorded on the audit row for accountability. */
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user: actor } = await requireAdminSession(event);
  const userId = getRouterParam(event, 'id');
  if (!userId) {
    throw createError({ statusCode: 400, message: 'Missing user id' });
  }
  const body = await readValidatedBody(event, bodySchema.parse);

  // Lock the row, clamp the new balance, write the grant, all in one tx.
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.execute<{
      id: string;
      bonus_points: number;
    }>(
      sql`SELECT id, bonus_points FROM ${schema.users}
          WHERE id = ${userId} FOR UPDATE`
    );
    if (!row) {
      throw createError({ statusCode: 404, message: 'User not found' });
    }
    // Clamp to ≥ 0. An admin asking to subtract more than the user
    // has lands the balance at 0 rather than going negative, and the
    // grant row records the actual delta applied.
    const before = row.bonus_points;
    const desiredAfter = before + body.delta;
    const after = Math.max(0, desiredAfter);
    const appliedDelta = after - before;
    if (appliedDelta === 0) {
      // User's balance is already 0 and admin tried to remove more.
      // Surface as a 400 so the FE can explain rather than flash a
      // mute "success".
      throw createError({
        statusCode: 400,
        message: 'Balance already at zero — cannot remove more',
      });
    }

    await tx.execute(
      sql`UPDATE ${schema.users}
          SET bonus_points = ${after}
          WHERE id = ${userId}`
    );
    await tx.insert(schema.bonusGrants).values({
      id: uuidv4(),
      userId,
      source: 'admin_adjust',
      torrentId: null,
      amount: appliedDelta,
      metadata: {
        actorId: actor.id,
        actorUsername: actor.username,
        note: body.note ?? null,
        balanceBefore: before,
        balanceAfter: after,
        requestedDelta: body.delta,
      },
    });

    return { before, after, appliedDelta };
  });

  void notify(
    userId,
    'bonus_points_adjusted',
    {
      delta: result.appliedDelta,
      before: result.before,
      after: result.after,
      note: body.note ?? null,
      actorUsername: actor.username,
    },
    '/me',
  );

  return { success: true, ...result };
});
