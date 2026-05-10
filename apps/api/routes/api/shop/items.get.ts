/**
 * GET /api/shop/items — user-facing catalogue.
 *
 * Returns every shop item that's currently buyable: enabled and
 * (when bounded) with stock > 0. The user's current `bonus_points`
 * balance ships in the same payload so the FE can render
 * affordability state without a second round-trip.
 *
 * Item descriptions are returned in a structured form ({ type, args })
 * so the FE renders them through i18n at the call site instead of
 * the API hard-coding English.
 */
import { eq, and, or, isNull, gt, asc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { describeItem, type ShopItemType } from '~~/utils/shop';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);

  const items = await db
    .select({
      id: schema.shopItems.id,
      name: schema.shopItems.name,
      description: schema.shopItems.description,
      icon: schema.shopItems.icon,
      type: schema.shopItems.type,
      payload: schema.shopItems.payload,
      cost: schema.shopItems.cost,
      stock: schema.shopItems.stock,
    })
    .from(schema.shopItems)
    .where(
      and(
        eq(schema.shopItems.enabled, true),
        // Either unlimited (stock IS NULL) or remaining stock > 0.
        or(isNull(schema.shopItems.stock), gt(schema.shopItems.stock, 0))
      )
    )
    .orderBy(asc(schema.shopItems.cost));

  // Re-read balance so a stale session doesn't lie to the FE.
  const [me] = await db
    .select({ bonusPoints: schema.users.bonusPoints })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
    .limit(1);

  return {
    bonusPoints: me?.bonusPoints ?? 0,
    items: items.map((it) => ({
      id: it.id,
      name: it.name,
      description: it.description,
      icon: it.icon,
      cost: it.cost,
      stock: it.stock,
      effect: describeItem(it.type as ShopItemType, it.payload),
    })),
  };
});
