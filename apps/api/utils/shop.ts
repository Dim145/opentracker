/**
 * Shop helpers — central place for the seed-bonus shop's purchase
 * logic and effect application. Anything that mutates `users.bonus_points`
 * or applies a shop item's payload goes through here so the audit
 * trail (`shop_purchases`) and the atomic balance / stock decrements
 * stay consistent.
 *
 * Item effects are typed via `ShopItemType`. Adding a new type is a
 * three-step contract:
 *   1. extend the union below
 *   2. add a payload schema to `shopItemPayloadSchemas`
 *   3. add a handler to `applyItemEffect`
 *
 * The admin write path (`POST/PATCH /api/admin/shop/items`) validates
 * `type` + `payload` against the schema; the user purchase path
 * (`POST /api/shop/buy`) re-reads the row and applies the effect from
 * within a transaction so a stale read can't be exploited.
 */
import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

export const SHOP_ITEM_TYPES = ['upload_credit', 'invite'] as const;
export type ShopItemType = (typeof SHOP_ITEM_TYPES)[number];

// --------------------------------------------------------------------------
// Per-type payload validation
// --------------------------------------------------------------------------

const uploadCreditPayload = z
  .object({
    // Number of bytes to credit on `users.uploaded` when the item is
    // bought. Capped at 10 TiB per single purchase so a typo in admin
    // can't gift petabyte-scale ratio relief.
    bytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024 * 1024 * 1024),
  })
  .strict();

const invitePayload = z
  .object({
    // Number of invitation slots to add to `users.invites_remaining`.
    // Capped at 10 per item — anything larger is almost certainly a
    // mistake; admins can simply create another item if they want
    // a bigger bundle.
    count: z.number().int().positive().max(10),
  })
  .strict();

export const shopItemPayloadSchemas: Record<ShopItemType, z.ZodTypeAny> = {
  upload_credit: uploadCreditPayload,
  invite: invitePayload,
};

/**
 * Validate that a (type, payload) pair is well-formed. Throws a Zod
 * error on mismatch. Used by the admin create / update routes.
 */
export function validateItemPayload(
  type: ShopItemType,
  payload: unknown
): unknown {
  return shopItemPayloadSchemas[type].parse(payload);
}

// --------------------------------------------------------------------------
// Display formatting (used by the user-facing /api/shop/items response)
// --------------------------------------------------------------------------

/**
 * Render a human-readable summary of an item's effect for the shop
 * card. Pure function over (type, payload) — never touches the DB.
 *
 * Returned text is locale-agnostic and structured so the FE can either
 * render it as-is or treat the `type` + `args` as i18n inputs.
 */
export function describeItem(
  type: ShopItemType,
  payload: unknown
): { type: ShopItemType; args: Record<string, number> } {
  switch (type) {
    case 'upload_credit': {
      const { bytes } = uploadCreditPayload.parse(payload);
      return { type, args: { bytes } };
    }
    case 'invite': {
      const { count } = invitePayload.parse(payload);
      return { type, args: { count } };
    }
  }
}

// --------------------------------------------------------------------------
// Purchase flow
// --------------------------------------------------------------------------

export class ShopError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/**
 * Atomic purchase. Within a single transaction:
 *   1. lock the item row + the user row (FOR UPDATE)
 *   2. verify the item is enabled, in stock, and the user can afford it
 *   3. apply the type-specific effect to the user row
 *   4. decrement bonus_points and the item's stock (if bounded)
 *   5. write a snapshot row to shop_purchases
 *
 * Any failure rolls the whole thing back.
 */
export async function purchaseItem(
  userId: string,
  itemId: string
): Promise<{
  bonusPointsAfter: number;
  appliedEffect: ReturnType<typeof describeItem>;
}> {
  return db.transaction(async (tx) => {
    // Lock the rows we're about to mutate. Without `FOR UPDATE` two
    // concurrent buy clicks can both see balance >= cost and double-spend.
    const [item] = await tx.execute<{
      id: string;
      type: string;
      payload: unknown;
      cost: number;
      stock: number | null;
      enabled: boolean;
      name: string;
    }>(
      sql`SELECT id, type, payload, cost, stock, enabled, name FROM ${schema.shopItems} WHERE id = ${itemId} FOR UPDATE`
    );
    if (!item) throw new ShopError(404, 'Item not found');
    if (!item.enabled) throw new ShopError(400, 'Item is not currently for sale');
    if (item.stock !== null && item.stock <= 0) {
      throw new ShopError(400, 'Item is out of stock');
    }
    if (!SHOP_ITEM_TYPES.includes(item.type as ShopItemType)) {
      // Forward-compat guard: the row references a type we don't know.
      // Refuse to apply rather than fall through to no-op.
      throw new ShopError(500, 'Unknown item type');
    }

    const [user] = await tx.execute<{
      id: string;
      bonus_points: number;
      uploaded: number;
      invites_remaining: number;
    }>(
      sql`SELECT id, bonus_points, uploaded, invites_remaining FROM ${schema.users} WHERE id = ${userId} FOR UPDATE`
    );
    if (!user) throw new ShopError(404, 'User not found');
    if (user.bonus_points < item.cost) {
      throw new ShopError(400, 'Not enough bonus points');
    }

    // Apply the type-specific effect on the user row.
    const itemType = item.type as ShopItemType;
    let updateColumns: string;
    if (itemType === 'upload_credit') {
      const { bytes } = uploadCreditPayload.parse(item.payload);
      // Increment both `uploaded` (so the user's ratio benefits) AND
      // `bonus_uploaded` (so the /me KPI can split "real vs. bonus"
      // bytes). Both columns + the points debit ride the same tx so
      // they can't drift apart on a partial failure.
      await tx.execute(
        sql`UPDATE ${schema.users}
            SET uploaded = uploaded + ${bytes},
                bonus_uploaded = bonus_uploaded + ${bytes},
                bonus_points = bonus_points - ${item.cost}
            WHERE id = ${userId}`
      );
      updateColumns = 'uploaded';
    } else if (itemType === 'invite') {
      const { count } = invitePayload.parse(item.payload);
      await tx.execute(
        sql`UPDATE ${schema.users}
            SET invites_remaining = invites_remaining + ${count},
                bonus_points = bonus_points - ${item.cost}
            WHERE id = ${userId}`
      );
      updateColumns = 'invites_remaining';
    } else {
      throw new ShopError(500, `Unhandled item type: ${itemType}`);
    }

    // Decrement stock when bounded.
    if (item.stock !== null) {
      await tx.execute(
        sql`UPDATE ${schema.shopItems} SET stock = stock - 1 WHERE id = ${itemId}`
      );
    }

    // Audit ledger row.
    await tx.execute(
      sql`INSERT INTO ${schema.shopPurchases}
          (id, user_id, item_id, item_name_snapshot, item_type_snapshot, cost_paid)
          VALUES (${uuidv4()}, ${userId}, ${itemId}, ${item.name}, ${item.type}, ${item.cost})`
    );

    // Re-read the user row to return the post-purchase balance so the
    // FE can update without a second round-trip.
    const [refreshed] = await tx.execute<{ bonus_points: number }>(
      sql`SELECT bonus_points FROM ${schema.users} WHERE id = ${userId}`
    );

    return {
      bonusPointsAfter: refreshed.bonus_points,
      appliedEffect: describeItem(itemType, item.payload),
    };
  });
}

// --------------------------------------------------------------------------
// Bonus accumulation
// --------------------------------------------------------------------------

/**
 * Apply the per-hour seed-bonus accrual. Called by the cron plugin
 * once an hour (configurable via env). For each user with at least
 * one active seed in Redis, credit `rate × seed_count` points.
 *
 * This is intentionally coarse — we don't track partial-hour seeding;
 * a peer that announced 30 minutes before the cron run still gets
 * a full point for that interval, which both rewards consistent
 * seeders and avoids us trying to reconcile the announce log.
 */
export async function creditBonusForUserSeeds(
  userIdToSeedCount: Map<string, number>,
  rate: number
): Promise<{ usersCredited: number; pointsAwarded: number }> {
  if (userIdToSeedCount.size === 0) {
    return { usersCredited: 0, pointsAwarded: 0 };
  }
  let usersCredited = 0;
  let pointsAwarded = 0;
  // Cap each user's per-cycle credit so a misconfigured rate or a
  // seed-count blowup can't gift millions of points in one go.
  const PER_CYCLE_CAP = 10_000;
  for (const [userId, seedCount] of userIdToSeedCount) {
    const credit = Math.min(seedCount * rate, PER_CYCLE_CAP);
    if (credit <= 0) continue;
    await db.execute(
      sql`UPDATE ${schema.users}
          SET bonus_points = bonus_points + ${credit}
          WHERE id = ${userId}`
    );
    usersCredited++;
    pointsAwarded += credit;
  }
  return { usersCredited, pointsAwarded };
}
