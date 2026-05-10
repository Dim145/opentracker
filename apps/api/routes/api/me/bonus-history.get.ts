/**
 * GET /api/me/bonus-history
 *
 * Per-user transaction ledger for the seed-bonus economy. Merges two
 * sources into one chronological feed:
 *
 *   - `bonus_grants` — every credit (or admin-driven debit) the user
 *     received. Positive `amount` = points added; negative = points
 *     revoked by an admin. The `source` column matches a bonus rule
 *     kind (`seeding`, `first_seeder`, `account_age_monthly`, …) or
 *     the special `admin_adjust`.
 *   - `shop_purchases` — every time the user spent points in `/shop`.
 *     `cost_paid` is the snapshot at purchase time.
 *
 * The two streams are normalised into a single shape (`BonusEntry`)
 * and sorted by `createdAt` desc. We cap at 100 rows by default —
 * the /me UI renders an accordion that streams the lot inline; a
 * heavier consumer can paginate via `?limit=` and `?cursor=` (cursor
 * is the createdAt of the oldest row in the previous page, ISO).
 *
 * No moderator visibility — this is a self-only endpoint, gated by
 * `requireUserSession`.
 */
import { and, desc, eq, lt } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { z } from 'zod';

interface BonusEntry {
  /** Stable id; prefixed by source so grants and purchases can't collide. */
  id: string;
  /** Sign of the transaction. Drives the up/down arrow + colour in the UI. */
  type: 'gain' | 'spend';
  /** Always positive. The wire format never sends a negative; the UI
   *  derives the sign from `type`. */
  amount: number;
  /** Categorical reason key. The frontend maps it to a localised label;
   *  unknown values fall back to a generic "Adjustment". */
  source:
    | 'seeding'
    | 'first_seeder'
    | 'milestone'
    | 'account_age_monthly'
    | 'daily_login'
    | 'admin_adjust'
    | 'shop_purchase'
    | string;
  /** Human-readable note. Admin adjusts surface their `metadata.note`;
   *  shop purchases surface the item name snapshot; rule grants leave
   *  it empty (the source key is enough to label them). */
  message: string | null;
  /** ISO timestamp. */
  createdAt: string;
}

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  /** Pagination cursor — ISO timestamp of the oldest row in the
   *  previous page. We pull rows strictly older than this. */
  cursor: z.string().datetime().optional(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const { limit, cursor } = await getValidatedQuery(event, querySchema.parse);
  const cursorDate = cursor ? new Date(cursor) : null;

  // Pull both streams in parallel. We over-fetch slightly (`limit + 1`
  // each) so we can offer an accurate `hasMore` flag after the merge,
  // even when one stream dominates the time window.
  const grantsWhere = cursorDate
    ? and(
        eq(schema.bonusGrants.userId, user.id),
        lt(schema.bonusGrants.createdAt, cursorDate),
      )
    : eq(schema.bonusGrants.userId, user.id);
  const purchasesWhere = cursorDate
    ? and(
        eq(schema.shopPurchases.userId, user.id),
        lt(schema.shopPurchases.createdAt, cursorDate),
      )
    : eq(schema.shopPurchases.userId, user.id);

  const [grants, purchases] = await Promise.all([
    db
      .select({
        id: schema.bonusGrants.id,
        source: schema.bonusGrants.source,
        amount: schema.bonusGrants.amount,
        metadata: schema.bonusGrants.metadata,
        createdAt: schema.bonusGrants.createdAt,
      })
      .from(schema.bonusGrants)
      .where(grantsWhere)
      .orderBy(desc(schema.bonusGrants.createdAt))
      .limit(limit + 1),
    db
      .select({
        id: schema.shopPurchases.id,
        itemNameSnapshot: schema.shopPurchases.itemNameSnapshot,
        costPaid: schema.shopPurchases.costPaid,
        createdAt: schema.shopPurchases.createdAt,
      })
      .from(schema.shopPurchases)
      .where(purchasesWhere)
      .orderBy(desc(schema.shopPurchases.createdAt))
      .limit(limit + 1),
  ]);

  // Normalise both into the wire shape, then merge-sort.
  const entries: BonusEntry[] = [
    ...grants.map<BonusEntry>((g) => {
      const meta = (g.metadata ?? {}) as { note?: string | null };
      return {
        id: `g:${g.id}`,
        type: g.amount >= 0 ? 'gain' : 'spend',
        amount: Math.abs(g.amount),
        source: g.source,
        message: typeof meta.note === 'string' && meta.note ? meta.note : null,
        createdAt: g.createdAt.toISOString(),
      };
    }),
    ...purchases.map<BonusEntry>((p) => ({
      id: `p:${p.id}`,
      type: 'spend',
      amount: p.costPaid,
      source: 'shop_purchase',
      // The item name snapshot doubles as the message — it's already
      // the right human-readable label and survives a later rename of
      // the catalogue item.
      message: p.itemNameSnapshot,
      createdAt: p.createdAt.toISOString(),
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const hasMore = entries.length > limit;
  const items = entries.slice(0, limit);
  const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

  return {
    items,
    hasMore,
    nextCursor,
  };
});
