/**
 * Bonus events helpers — Freeleech / Silverleech / custom multipliers.
 *
 * Three things live here so the route handlers stay thin:
 *
 *   1. Range constants + the formatter used by the frontend.
 *
 *   2. Overlap detection. The product rule is "at most one window
 *      active at a time", so on insert/update we refuse a new row
 *      whose [startsAt, endsAt) intersects another `enabled = true`
 *      row's window. The check is a single SQL `where` and runs in
 *      the same transaction as the insert/update so concurrent admin
 *      writes can't race past it.
 *
 *   3. Redis snapshot of the currently-active window. The Go tracker
 *      reads this on the announce hot path (with its own 30s in-memory
 *      cache) to scale upload/download deltas before persisting them.
 *      We rebuild the snapshot on every admin mutation and stamp a
 *      generous TTL so a missed mutation eventually self-heals on the
 *      next /active request.
 *
 * All multipliers in this file are basis points (×100): `100` = 1.00x,
 * `0` = freeleech, `50` = silverleech, `1000` = 10.00x upload bonus.
 */
import { db } from '@trackarr/db';
import { bonusEvents } from '@trackarr/db/schema';
import { and, desc, eq, gt, lt, lte, ne } from 'drizzle-orm';
import { redis } from '../redis/client';

// ── Multiplier ranges ───────────────────────────────────────

/** Inclusive bounds; UI sliders + zod schemas mirror these. */
export const DOWNLOAD_MULTIPLIER_MIN = 0;
export const DOWNLOAD_MULTIPLIER_MAX = 200; // 2.00x
export const UPLOAD_MULTIPLIER_MIN = 0;
export const UPLOAD_MULTIPLIER_MAX = 1000; // 10.00x

/** Two well-known presets exposed as one-click buttons in the UI. */
export const PRESETS = {
  freeleech: { downloadMultiplier: 0, uploadMultiplier: 100 },
  silverleech: { downloadMultiplier: 50, uploadMultiplier: 100 },
} as const;

// ── Active-window resolver (canonical source of truth) ──────

/** Snapshot stored in Redis for the tracker's hot path. */
export interface ActiveBonusEventSnapshot {
  id: string;
  title: string;
  /** Basis points × 100. Tracker computes `delta * mul / 100`. */
  downloadMultiplier: number;
  uploadMultiplier: number;
  /** Unix epoch (ms). */
  startsAtMs: number;
  endsAtMs: number;
}

const ACTIVE_KEY = 'bonus:active';
// Long TTL — the snapshot is the canonical source for the tracker
// between mutations, but we re-stamp on every admin write and on every
// /api/bonus/active read, so a stale value can only persist if both
// fail. 5 minutes balances "self-heal quickly" against "don't thrash
// Redis on a quiet site".
const ACTIVE_TTL_S = 5 * 60;

/**
 * Pick the row whose [startsAt, endsAt) bracket the given instant.
 * Returns null when nothing's active. There can only be one — the
 * overlap check forbids more — but if for any reason the DB ends up
 * with two we deterministically prefer the most recently created one
 * so the behaviour stays predictable.
 */
export async function resolveActive(
  now: Date = new Date()
): Promise<ActiveBonusEventSnapshot | null> {
  const row = await db.query.bonusEvents.findFirst({
    where: and(
      eq(bonusEvents.enabled, true),
      lte(bonusEvents.startsAt, now),
      gt(bonusEvents.endsAt, now)
    ),
    orderBy: [desc(bonusEvents.createdAt)],
    columns: {
      id: true,
      title: true,
      downloadMultiplier: true,
      uploadMultiplier: true,
      startsAt: true,
      endsAt: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    downloadMultiplier: row.downloadMultiplier,
    uploadMultiplier: row.uploadMultiplier,
    startsAtMs: row.startsAt.getTime(),
    endsAtMs: row.endsAt.getTime(),
  };
}

/**
 * Re-resolve and write the snapshot to Redis. Called after every
 * admin mutation + as a safety net inside `/api/bonus/active` so the
 * snapshot self-heals on a normal page load if it ever drifts.
 *
 * When nothing is active we delete the key (simpler for the tracker:
 * "key missing → no multiplier" rather than a sentinel value).
 */
export async function syncActiveSnapshot(): Promise<ActiveBonusEventSnapshot | null> {
  const snap = await resolveActive();
  if (snap) {
    await redis.setex(ACTIVE_KEY, ACTIVE_TTL_S, JSON.stringify(snap));
  } else {
    await redis.del(ACTIVE_KEY);
  }
  return snap;
}

/**
 * Fast read for the tracker / web. Fall back to a DB resolve if the
 * snapshot is missing, and re-stamp the cache on the way out so the
 * next caller pays the cheaper Redis hit. The DB query is cheap (one
 * index lookup) so even the cold path stays under a millisecond.
 */
export async function getActiveSnapshot(): Promise<ActiveBonusEventSnapshot | null> {
  const cached = await redis.get(ACTIVE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as ActiveBonusEventSnapshot;
      // Belt-and-braces: if the cached snapshot's window has ended
      // (e.g. nobody mutated since the last hour and TTL is still
      // alive), don't trust it.
      if (parsed.endsAtMs > Date.now()) return parsed;
    } catch {
      /* fall through to DB */
    }
  }
  return syncActiveSnapshot();
}

// ── Overlap check ───────────────────────────────────────────

/**
 * True if any other `enabled = true` row's window overlaps `[start,
 * end)`. Pass `excludeId` when updating a row so it doesn't conflict
 * with itself.
 *
 * Two windows [a, b) and [c, d) overlap iff `a < d && c < b`.
 */
export async function hasOverlap(
  startsAt: Date,
  endsAt: Date,
  excludeId?: string
): Promise<boolean> {
  const conditions = [
    eq(bonusEvents.enabled, true),
    lt(bonusEvents.startsAt, endsAt),
    gt(bonusEvents.endsAt, startsAt),
  ];
  if (excludeId) conditions.push(ne(bonusEvents.id, excludeId));
  const row = await db.query.bonusEvents.findFirst({
    where: and(...conditions),
    columns: { id: true },
  });
  return !!row;
}

// ── Display helpers ─────────────────────────────────────────

/**
 * Best-guess label for a multiplier set ("Freeleech", "Silverleech",
 * or null for custom). Used to decorate the navbar icon and the
 * admin list with the matching preset name.
 */
export function presetLabel(
  downloadMultiplier: number,
  uploadMultiplier: number
): 'freeleech' | 'silverleech' | null {
  if (downloadMultiplier === 0 && uploadMultiplier === 100) return 'freeleech';
  if (downloadMultiplier === 50 && uploadMultiplier === 100)
    return 'silverleech';
  return null;
}
