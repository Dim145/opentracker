/**
 * Freeleech pool service — contributory site-wide freeleech.
 *
 * The pool is one of three subsystems that mutate `bonus_events`
 * rows on the announce hot path; the other two are the admin's
 * manual create/update routes and the legacy seeding earnings.
 *
 * State machine (column `freeleech_pool_cycles.status`):
 *
 *     filling ─── target reached, freeleech event already active ──┐
 *        │                                                          │
 *        └─── target reached, no event in flight ──┐                ▼
 *                                                  │           full_queued
 *                                                  ▼                │
 *                                               active ◄────────────┘
 *                                                  │   (cron: blocker ended,
 *                                                  │    we now create event)
 *                                                  │
 *                                 ends_at elapsed ─┴──► ended ──► new filling cycle
 *
 *      ┌── admin reset ──► cancelled (no replacement cycle created)
 *
 * Three product invariants protect contributors from being surprised:
 *
 *   1. **No retroactive goalpost shift** — `target_snapshot` and
 *      `duration_days_snapshot` freeze at cycle creation; admin
 *      config changes only affect future cycles.
 *
 *   2. **At most one open cycle** — enforced by the
 *      `freeleech_pool_cycles_open_unique` partial index plus the
 *      Postgres advisory lock taken at the start of every state
 *      transition (contribute, trigger, end).
 *
 *   3. **Original event preserved** — when the pool fires while a
 *      non-freeleech bonus event is running, the pool stashes the
 *      original event's params + remaining duration on the cycle row.
 *      When the pool event ends, the cron re-creates the original
 *      for the time it still had to live.
 */
import { randomUUID } from 'node:crypto';
import { and, desc, eq, lte, sql, sum } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  hasOverlap,
  lockBonusEventsForWrite,
  syncActiveSnapshot,
  resolveActive,
} from './bonusEvents';

// ── Constants ──────────────────────────────────────────────────────

/** Singleton row id for `freeleech_pool_config`. */
export const POOL_CONFIG_ID = 1;

/** Advisory lock id scoped to "any write that touches the pool state".
 *  ASCII `FPOO` = 1179796303. Distinct from the bonus-events lock
 *  (`BONU`, 1112757589) so the two subsystems don't artificially
 *  serialise — they only contend when a transition crosses both. */
const POOL_ADVISORY_LOCK_ID = 0x46504f4f;

/** Upper bound on `points_target`. A misconfigured high value
 *  effectively softlocks the pool but doesn't damage anything; the
 *  cap is a guardrail against typos. */
export const POINTS_TARGET_MAX = 100_000_000;

/** Upper bound on `freeleech_duration_days`. 30 days is already
 *  exceptional — anything beyond is almost certainly a typo. */
export const DURATION_DAYS_MAX = 30;

/** Cap basis points × 100. 10000 = 100% of the pool. 0 disables
 *  the cap entirely. */
export const MAX_PER_USER_BP_MAX = 10_000;

// ── Types ──────────────────────────────────────────────────────────

export type PoolStatus =
  | 'filling'
  | 'full_queued'
  | 'active'
  | 'ended'
  | 'cancelled';

export interface PoolConfig {
  id: number;
  enabled: boolean;
  pointsTarget: number;
  freeleechDurationDays: number;
  contributionMin: number;
  maxPerUserBp: number;
  presetAmounts: number[];
  eventTitleTemplate: string | null;
  eventDescriptionTemplate: string | null;
  eventLongDescriptionTemplate: string | null;
  updatedAt: Date | null;
}

export interface PoolCycle {
  id: string;
  status: PoolStatus;
  targetSnapshot: number;
  durationDaysSnapshot: number;
  totalContributed: number;
  startedAt: Date | null;
  endsAt: Date | null;
  triggeredEventId: string | null;
  waitingOnEventId: string | null;
  createdAt: Date;
}

export interface ContributeResult {
  amountAccepted: number;
  bonusPointsAfter: number;
  cycle: PoolCycle;
  triggered: boolean;
}

export class FreeleechPoolError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

// ── Locks ──────────────────────────────────────────────────────────

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Hold the pool advisory lock for the rest of the transaction.
 *  Postgres auto-releases on COMMIT/ROLLBACK so we never have to
 *  think about cleanup. Always call before any read-then-write on
 *  the cycle / contribution tables. */
export async function lockPoolForWrite(tx: Tx): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${POOL_ADVISORY_LOCK_ID}::bigint)`
  );
}

// ── Config ─────────────────────────────────────────────────────────

/** Upsert + return the singleton config row. The first read after a
 *  fresh install lands here with no row yet; we insert defaults so
 *  callers can rely on a row always being present. */
export async function getConfig(): Promise<PoolConfig> {
  const [row] = await db
    .select()
    .from(schema.freeleechPoolConfig)
    .where(eq(schema.freeleechPoolConfig.id, POOL_CONFIG_ID))
    .limit(1);
  if (row) return rowToConfig(row);

  // Insert default row. ON CONFLICT DO NOTHING handles the race
  // where two replicas boot up at the same moment.
  await db
    .insert(schema.freeleechPoolConfig)
    .values({ id: POOL_CONFIG_ID })
    .onConflictDoNothing();
  const [after] = await db
    .select()
    .from(schema.freeleechPoolConfig)
    .where(eq(schema.freeleechPoolConfig.id, POOL_CONFIG_ID))
    .limit(1);
  return rowToConfig(after!);
}

function rowToConfig(row: typeof schema.freeleechPoolConfig.$inferSelect): PoolConfig {
  return {
    id: row.id,
    enabled: row.enabled,
    pointsTarget: row.pointsTarget,
    freeleechDurationDays: row.freeleechDurationDays,
    contributionMin: row.contributionMin,
    maxPerUserBp: row.maxPerUserBp,
    presetAmounts: Array.isArray(row.presetAmounts) ? row.presetAmounts : [],
    eventTitleTemplate: row.eventTitleTemplate,
    eventDescriptionTemplate: row.eventDescriptionTemplate,
    eventLongDescriptionTemplate: row.eventLongDescriptionTemplate,
    updatedAt: row.updatedAt,
  };
}

// ── Window resolution ──────────────────────────────────────────────

/** Is the pool currently open for contributions?
 *
 *  Decision tree:
 *    - If no rows in `freeleech_pool_windows` → always open.
 *    - Otherwise → open iff at least one *enabled* row covers `now`.
 *
 *  Per-kind matching is delegated to the helpers below. All
 *  recurrence projections are UTC — admins author windows in UTC,
 *  the FE renders them in the user's locale.
 */
export async function isWindowOpen(now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .select()
    .from(schema.freeleechPoolWindows)
    .where(eq(schema.freeleechPoolWindows.enabled, true));
  if (rows.length === 0) return true;

  for (const w of rows) {
    if (w.kind === 'oneoff') {
      if (w.startsAt && w.endsAt && w.startsAt <= now && now < w.endsAt) {
        return true;
      }
      continue;
    }
    if (
      w.kind === 'weekly' &&
      w.weekdayStart !== null &&
      w.weekdayEnd !== null &&
      w.minuteStart !== null &&
      w.minuteEnd !== null &&
      weeklyCovers(now, w.weekdayStart, w.minuteStart, w.weekdayEnd, w.minuteEnd)
    ) {
      return true;
    }
    if (
      w.kind === 'monthly' &&
      Array.isArray(w.monthlyDays) &&
      w.monthlyDays.length > 0 &&
      monthlyCovers(now, w.monthlyDays, w.minuteStart, w.minuteEnd)
    ) {
      return true;
    }
    if (
      w.kind === 'yearly' &&
      w.yearMonthStart !== null &&
      w.yearDayStart !== null &&
      w.yearMonthEnd !== null &&
      w.yearDayEnd !== null &&
      yearlyCovers(
        now,
        w.yearMonthStart,
        w.yearDayStart,
        w.yearMonthEnd,
        w.yearDayEnd
      )
    ) {
      return true;
    }
  }
  return false;
}

/** True when `now` falls inside the weekly [start, end) projected
 *  onto the *current* week. */
export function weeklyCovers(
  now: Date,
  weekdayStart: number,
  minuteStart: number,
  weekdayEnd: number,
  minuteEnd: number
): boolean {
  const dayMs = 24 * 60 * 60 * 1000;
  const minuteMs = 60 * 1000;
  const todayWeekday = now.getUTCDay();
  const todayMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  // Move back to the most recent Sunday (weekday=0) midnight so the
  // weekday-of-week offsets are anchored consistently.
  const sundayUtc = todayMidnight - todayWeekday * dayMs;
  let startUtc = sundayUtc + weekdayStart * dayMs + minuteStart * minuteMs;
  let endUtc = sundayUtc + weekdayEnd * dayMs + minuteEnd * minuteMs;
  // Window crosses week boundary (e.g. Sun 22:00 → Mon 02:00 encoded
  // as weekdayStart=0/minuteStart=1320, weekdayEnd=1/minuteEnd=120):
  // push end by a week so the comparison is sane.
  if (endUtc <= startUtc) endUtc += 7 * dayMs;
  const t = now.getTime();
  if (t >= startUtc && t < endUtc) return true;
  // Last week's instance — for windows that straddle Sunday midnight
  // and whose "current week" projection lands in the future.
  if (t >= startUtc - 7 * dayMs && t < endUtc - 7 * dayMs) return true;
  return false;
}

/** True when `now`'s day-of-month is in `days` and the time-of-day
 *  is within `[minuteStart, minuteEnd)`. When either minute bound is
 *  null we treat the window as whole-day (00:00 → 24:00). */
export function monthlyCovers(
  now: Date,
  days: number[],
  minuteStart: number | null,
  minuteEnd: number | null
): boolean {
  const today = now.getUTCDate();
  if (!days.includes(today)) return false;
  const minOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMin = minuteStart ?? 0;
  const endMin = minuteEnd ?? 1440;
  // Allow `endMin <= startMin` to encode a window that crosses
  // midnight (e.g. 22:00 → 02:00 of the *next* day). We catch the
  // "early next day" case by also accepting yesterday's window
  // wrapping into today.
  if (endMin > startMin) {
    return minOfDay >= startMin && minOfDay < endMin;
  }
  // Cross-midnight: open from startMin..end-of-day, then 0..endMin
  // on the next day. The "next day" portion requires that yesterday
  // was a listed day.
  if (minOfDay >= startMin) return true;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yDay = yesterday.getUTCDate();
  if (days.includes(yDay) && minOfDay < endMin) return true;
  return false;
}

/** True when `now`'s month/day falls inside the yearly range
 *  `[startMonth/startDay, endMonth/endDay]` (inclusive on both ends).
 *  Whole-day windows — yearly entries are designed for festivals /
 *  seasonal events where the time-of-day granularity isn't useful.
 *  The range may cross the Dec 31 → Jan 1 boundary (e.g. winter
 *  break: Dec 20 → Jan 5). */
export function yearlyCovers(
  now: Date,
  startMonth: number,
  startDay: number,
  endMonth: number,
  endDay: number
): boolean {
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  // Encode each (month, day) tuple as a single integer for cheap
  // ordering. Day=DD, month=MM → MMDD. February 29 collapses to
  // 0229 which sorts naturally between 0228 and 0301.
  const here = m * 100 + d;
  const start = startMonth * 100 + startDay;
  const end = endMonth * 100 + endDay;
  if (start <= end) {
    return here >= start && here <= end;
  }
  // Cross-year wraparound (e.g. Dec 20 → Jan 5):
  return here >= start || here <= end;
}

// ── Cycle helpers ──────────────────────────────────────────────────

/** Return the currently-open cycle, creating one if there isn't.
 *  Open = status in (filling, full_queued, active). The partial
 *  unique index makes the open-row guarantee structural, not just
 *  by-convention. */
export async function getOrCreateCurrentCycle(
  tx: Tx,
  config: PoolConfig
): Promise<typeof schema.freeleechPoolCycles.$inferSelect> {
  const [existing] = await tx
    .select()
    .from(schema.freeleechPoolCycles)
    .where(
      sql`status IN ('filling', 'full_queued', 'active')`
    )
    .limit(1);
  if (existing) return existing;

  const id = randomUUID();
  const [inserted] = await tx
    .insert(schema.freeleechPoolCycles)
    .values({
      id,
      status: 'filling',
      targetSnapshot: config.pointsTarget,
      durationDaysSnapshot: config.freeleechDurationDays,
    })
    .returning();
  return inserted;
}

/** Read-only fetch of the current open cycle (or the most recent
 *  closed one if no cycle is open). Used by the public state
 *  endpoint to render the shop widget. */
export async function getCurrentCycle(): Promise<typeof schema.freeleechPoolCycles.$inferSelect | null> {
  const [open] = await db
    .select()
    .from(schema.freeleechPoolCycles)
    .where(sql`status IN ('filling', 'full_queued', 'active')`)
    .limit(1);
  if (open) return open;
  const [latest] = await db
    .select()
    .from(schema.freeleechPoolCycles)
    .orderBy(desc(schema.freeleechPoolCycles.createdAt))
    .limit(1);
  return latest ?? null;
}

// ── Per-cycle aggregates ───────────────────────────────────────────

/** Sum of a user's contributions to a given cycle. Used by the
 *  per-user cap check and the FE's "you contributed X" pill. */
export async function getUserContribution(
  cycleId: string,
  userId: string,
  tx: Tx | typeof db = db
): Promise<number> {
  const [row] = await tx
    .select({ total: sum(schema.freeleechPoolContributions.amount).as('total') })
    .from(schema.freeleechPoolContributions)
    .where(
      and(
        eq(schema.freeleechPoolContributions.cycleId, cycleId),
        eq(schema.freeleechPoolContributions.userId, userId)
      )
    );
  return Number(row?.total ?? 0);
}

/** Top contributors across a cycle, in descending order of total
 *  amount contributed. Used by the shop widget's "leaderboard". */
export async function getTopContributors(
  cycleId: string,
  limit = 5
): Promise<Array<{ userId: string; username: string; total: number }>> {
  const rows = await db
    .select({
      userId: schema.freeleechPoolContributions.userId,
      username: schema.users.username,
      total: sql<number>`COALESCE(SUM(${schema.freeleechPoolContributions.amount}), 0)::int`,
    })
    .from(schema.freeleechPoolContributions)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.freeleechPoolContributions.userId)
    )
    .where(eq(schema.freeleechPoolContributions.cycleId, cycleId))
    .groupBy(
      schema.freeleechPoolContributions.userId,
      schema.users.username
    )
    .orderBy(sql`COALESCE(SUM(${schema.freeleechPoolContributions.amount}), 0) DESC`)
    .limit(limit);
  return rows.map((r) => ({
    userId: r.userId,
    username: r.username,
    total: Number(r.total),
  }));
}

/** Distinct contributor count for the current cycle — surfaced by
 *  the prom metrics endpoint. */
export async function getContributorCount(cycleId: string): Promise<number> {
  const [row] = await db
    .select({
      count: sql<number>`COUNT(DISTINCT ${schema.freeleechPoolContributions.userId})::int`,
    })
    .from(schema.freeleechPoolContributions)
    .where(eq(schema.freeleechPoolContributions.cycleId, cycleId));
  return Number(row?.count ?? 0);
}

// ── Contribute (the main user-facing transition) ──────────────────

/** Apply a contribution.
 *
 *  Atomicity: a single transaction guards every check + mutation,
 *  with row locks on the user and a dedicated advisory lock on the
 *  pool subsystem. The advisory lock serialises with the cron's
 *  state transitions, so no contribution can land on a cycle that's
 *  being closed.
 *
 *  Capping: if the requested amount would push the total above the
 *  cycle's target, we silently cap to "exactly fill the pool". The
 *  user only pays for the bytes that actually fit; the returned
 *  `amountAccepted` is the truth. */
export async function contribute(
  userId: string,
  amount: number
): Promise<ContributeResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new FreeleechPoolError(400, 'Amount must be a positive integer');
  }

  const config = await getConfig();
  if (!config.enabled) {
    throw new FreeleechPoolError(400, 'Freeleech pool is disabled');
  }
  if (config.pointsTarget <= 0) {
    throw new FreeleechPoolError(400, 'Pool target is not configured');
  }
  if (!(await isWindowOpen())) {
    throw new FreeleechPoolError(400, 'Pool is closed right now');
  }
  if (amount < config.contributionMin) {
    throw new FreeleechPoolError(
      400,
      `Minimum contribution is ${config.contributionMin}`
    );
  }

  return db.transaction(async (tx) => {
    await lockPoolForWrite(tx);

    const cycleRow = await getOrCreateCurrentCycle(tx, config);
    if (cycleRow.status !== 'filling') {
      throw new FreeleechPoolError(
        409,
        'Pool is no longer accepting contributions'
      );
    }

    // Cap so we never overflow the target. If we land on the exact
    // target this contribution is the one that triggers the pool.
    const remaining = cycleRow.targetSnapshot - cycleRow.totalContributed;
    if (remaining <= 0) {
      throw new FreeleechPoolError(409, 'Pool is already full');
    }
    const accepted = Math.min(amount, remaining);

    // Per-user cap — basis-points over the *target*, not the current
    // total, so the cap is stable regardless of who got in first.
    if (config.maxPerUserBp > 0) {
      const userCap = Math.floor(
        (cycleRow.targetSnapshot * config.maxPerUserBp) / 10_000
      );
      const already = await getUserContribution(cycleRow.id, userId, tx);
      if (already + accepted > userCap) {
        const room = Math.max(0, userCap - already);
        if (room <= 0) {
          throw new FreeleechPoolError(
            400,
            'You have reached the per-user contribution cap for this cycle'
          );
        }
        // Fall back to the user's remaining headroom — better UX than
        // throwing when the user could have contributed less.
        if (room < accepted) {
          throw new FreeleechPoolError(
            400,
            `Per-user cap leaves you only ${room} point(s) of headroom`
          );
        }
      }
    }

    // Lock the user row, verify balance, then debit.
    const [userRow] = await tx.execute<{
      id: string;
      bonus_points: number;
    }>(
      sql`SELECT id, bonus_points FROM ${schema.users} WHERE id = ${userId} FOR UPDATE`
    );
    if (!userRow) {
      throw new FreeleechPoolError(404, 'User not found');
    }
    if (userRow.bonus_points < accepted) {
      throw new FreeleechPoolError(400, 'Not enough bonus points');
    }

    await tx.execute(
      sql`UPDATE ${schema.users}
          SET bonus_points = bonus_points - ${accepted}
          WHERE id = ${userId}`
    );

    const contributionId = randomUUID();
    await tx.insert(schema.freeleechPoolContributions).values({
      id: contributionId,
      cycleId: cycleRow.id,
      userId,
      amount: accepted,
    });

    // Audit row in the standard ledger so the per-user history page
    // shows pool contributions alongside earnings + shop purchases.
    await tx.insert(schema.bonusGrants).values({
      id: randomUUID(),
      userId,
      source: 'freeleech_pool',
      amount: -accepted,
      metadata: { cycleId: cycleRow.id, contributionId },
    });

    const newTotal = cycleRow.totalContributed + accepted;
    await tx
      .update(schema.freeleechPoolCycles)
      .set({ totalContributed: newTotal })
      .where(eq(schema.freeleechPoolCycles.id, cycleRow.id));

    let triggered = false;
    let nextCycle = { ...cycleRow, totalContributed: newTotal };

    if (newTotal >= cycleRow.targetSnapshot) {
      const result = await attemptTrigger(tx, cycleRow.id, config);
      triggered = result.triggered;
      nextCycle = { ...nextCycle, ...result.cycleAfter };
    }

    const [refreshed] = await tx.execute<{ bonus_points: number }>(
      sql`SELECT bonus_points FROM ${schema.users} WHERE id = ${userId}`
    );

    return {
      amountAccepted: accepted,
      bonusPointsAfter: refreshed?.bonus_points ?? 0,
      cycle: {
        id: nextCycle.id,
        status: nextCycle.status as PoolStatus,
        targetSnapshot: nextCycle.targetSnapshot,
        durationDaysSnapshot: nextCycle.durationDaysSnapshot,
        totalContributed: nextCycle.totalContributed,
        startedAt: nextCycle.startedAt,
        endsAt: nextCycle.endsAt,
        triggeredEventId: nextCycle.triggeredEventId,
        waitingOnEventId: nextCycle.waitingOnEventId,
        createdAt: nextCycle.createdAt,
      },
      triggered,
    };
  });
}

// ── Trigger / queue / overlay logic ───────────────────────────────

interface TriggerResult {
  triggered: boolean;
  cycleAfter: Partial<typeof schema.freeleechPoolCycles.$inferSelect>;
}

/** Move a `filling` cycle to either `active` (event created) or
 *  `full_queued` (waiting on an in-flight freeleech to end).
 *
 *  Idempotent: re-entering with a cycle that's already past
 *  `filling` is a no-op — used by both the contribute path (when
 *  the contribution itself fills the pool) and the cron (when it
 *  picks up a `full_queued` cycle whose blocker just ended). */
export async function attemptTrigger(
  tx: Tx,
  cycleId: string,
  config: PoolConfig
): Promise<TriggerResult> {
  // Re-fetch under the lock so we never act on a stale view.
  const [cycle] = await tx
    .select()
    .from(schema.freeleechPoolCycles)
    .where(eq(schema.freeleechPoolCycles.id, cycleId))
    .limit(1);
  if (!cycle) return { triggered: false, cycleAfter: {} };
  if (cycle.status === 'active' || cycle.status === 'ended') {
    return { triggered: false, cycleAfter: {} };
  }

  // Coordinate with the bonus-events overlap-write lock so we don't
  // race an admin creating a window at the same instant.
  await lockBonusEventsForWrite(tx);

  const now = new Date();
  const durationMs = cycle.durationDaysSnapshot * 24 * 60 * 60 * 1000;
  const endsAt = new Date(now.getTime() + durationMs);
  const active = await resolveActive(now);

  // No active event → start immediately.
  if (!active) {
    return await startFreeleechEvent(tx, cycle, config, now, endsAt);
  }

  // Already a freeleech in flight (downloadMultiplier === 0) →
  // queue. Cron will start us when the blocker ends.
  if (active.downloadMultiplier === 0) {
    const update: Partial<typeof schema.freeleechPoolCycles.$inferSelect> = {
      status: 'full_queued',
      waitingOnEventId: active.id,
    };
    await tx
      .update(schema.freeleechPoolCycles)
      .set(update)
      .where(eq(schema.freeleechPoolCycles.id, cycleId));
    return {
      triggered: false,
      cycleAfter: update,
    };
  }

  // Non-freeleech event running — preserve its identity (we'll
  // re-spawn it after our pool freeleech ends) and start the pool
  // freeleech overlay.
  const [activeFull] = await tx
    .select()
    .from(schema.bonusEvents)
    .where(eq(schema.bonusEvents.id, active.id))
    .limit(1);
  if (!activeFull) {
    // Snapshot drifted; fall back to the no-active path.
    return await startFreeleechEvent(tx, cycle, config, now, endsAt);
  }
  const remainingMs = Math.max(0, activeFull.endsAt.getTime() - now.getTime());

  // End the original event by disabling it. The active-resolver
  // filters on `enabled`, so this immediately removes it from the
  // tracker hot path snapshot.
  await tx
    .update(schema.bonusEvents)
    .set({ enabled: false, updatedAt: now })
    .where(eq(schema.bonusEvents.id, active.id));

  const overlayUploadMul = activeFull.uploadMultiplier;
  return await startFreeleechEvent(
    tx,
    cycle,
    config,
    now,
    endsAt,
    {
      uploadMultiplier: overlayUploadMul,
      pausedFromEvent: activeFull,
      pausedRemainingMs: remainingMs,
    }
  );
}

interface OverlayContext {
  uploadMultiplier: number;
  pausedFromEvent: typeof schema.bonusEvents.$inferSelect;
  pausedRemainingMs: number;
}

/** Create the pool-triggered `bonus_events` row, flip the cycle to
 *  `active`, and resync the snapshot. When called with an overlay
 *  context, the cycle row carries the original event's params for
 *  the post-pool resume. */
async function startFreeleechEvent(
  tx: Tx,
  cycle: typeof schema.freeleechPoolCycles.$inferSelect,
  config: PoolConfig,
  now: Date,
  endsAt: Date,
  overlay?: OverlayContext
): Promise<TriggerResult> {
  const eventId = randomUUID();
  const uploadMultiplier = overlay?.uploadMultiplier ?? 100;
  // Title stays a recognizable English/loanword fallback because the
  // notification renderer substitutes {title} into the
  // `bonus_event_started` template — an empty string would render as
  // " est actif". Admins can localize via the config template.
  const title =
    config.eventTitleTemplate?.trim() ||
    (overlay ? 'Pool Freeleech (overlay)' : 'Pool Freeleech');
  // Description / long description are NULL when the admin hasn't
  // configured a template — the modal renders a locale-aware default
  // in that case so the user-facing copy matches their UI language.
  const description = config.eventDescriptionTemplate?.trim() || null;
  const longDescription = config.eventLongDescriptionTemplate?.trim() || null;

  // Belt-and-braces overlap check inside the lock — covers the
  // unlikely race where the cron and an admin both try to act on
  // the same instant. The overlay branch already disabled the
  // blocker, so the only remaining conflicts are legitimate.
  if (await hasOverlap(now, endsAt, undefined, tx)) {
    throw new FreeleechPoolError(
      409,
      'Cannot start pool freeleech: another bonus event still covers this window'
    );
  }

  await tx.insert(schema.bonusEvents).values({
    id: eventId,
    title,
    description,
    longDescription,
    downloadMultiplier: 0, // Freeleech
    uploadMultiplier,
    startsAt: now,
    endsAt,
    enabled: true,
    source: 'freeleech_pool',
    createdById: null,
  });

  const update: Partial<typeof schema.freeleechPoolCycles.$inferSelect> = {
    status: 'active',
    startedAt: now,
    endsAt,
    triggeredEventId: eventId,
    waitingOnEventId: null,
  };
  if (overlay) {
    update.pausedEventTitle = overlay.pausedFromEvent.title;
    update.pausedEventDescription = overlay.pausedFromEvent.description;
    update.pausedEventLongDescription = overlay.pausedFromEvent.longDescription;
    update.pausedEventDownloadMultiplier =
      overlay.pausedFromEvent.downloadMultiplier;
    update.pausedEventUploadMultiplier =
      overlay.pausedFromEvent.uploadMultiplier;
    update.pausedEventRemainingMs = overlay.pausedRemainingMs;
    update.pausedEventCreatedById = overlay.pausedFromEvent.createdById;
  }
  await tx
    .update(schema.freeleechPoolCycles)
    .set(update)
    .where(eq(schema.freeleechPoolCycles.id, cycle.id));

  // Snapshot resync happens after the transaction commits so the
  // Redis state can't get ahead of Postgres on a rollback.
  return {
    triggered: true,
    cycleAfter: update,
  };
}

// ── Cron transitions ───────────────────────────────────────────────

/** Move every eligible `full_queued` cycle into `active`. Called by
 *  the pool cron. Returns the number of cycles successfully started
 *  so the cron's log line reflects the real impact. */
export async function tickStartQueued(): Promise<number> {
  const queued = await db
    .select()
    .from(schema.freeleechPoolCycles)
    .where(eq(schema.freeleechPoolCycles.status, 'full_queued'));
  if (queued.length === 0) return 0;

  const config = await getConfig();
  let started = 0;
  for (const cycle of queued) {
    try {
      const result = await db.transaction(async (tx) => {
        await lockPoolForWrite(tx);
        return await attemptTrigger(tx, cycle.id, config);
      });
      if (result.triggered) started++;
    } catch (err) {
      console.warn(
        '[FreeleechPool] tickStartQueued failed for',
        cycle.id,
        (err as Error).message
      );
    }
    // Snapshot resync after each cycle so a slow run still surfaces
    // its progress on the tracker hot path between iterations.
    await syncActiveSnapshot();
  }
  return started;
}

/** Close every cycle whose `ends_at` has passed. For each, restore
 *  the paused event (if any) and open a fresh `filling` cycle when
 *  the feature is still enabled. */
export async function tickEndExpired(): Promise<number> {
  const now = new Date();
  const expired = await db
    .select()
    .from(schema.freeleechPoolCycles)
    .where(
      and(
        eq(schema.freeleechPoolCycles.status, 'active'),
        lte(schema.freeleechPoolCycles.endsAt, now)
      )
    );
  if (expired.length === 0) return 0;

  const config = await getConfig();
  let ended = 0;
  for (const cycle of expired) {
    try {
      await db.transaction(async (tx) => {
        await lockPoolForWrite(tx);
        await lockBonusEventsForWrite(tx);

        // End the pool event — `enabled = false` removes it from the
        // active-resolver immediately.
        if (cycle.triggeredEventId) {
          await tx
            .update(schema.bonusEvents)
            .set({ enabled: false, updatedAt: now })
            .where(eq(schema.bonusEvents.id, cycle.triggeredEventId));
        }

        // Restore the paused event when we displaced one.
        if (
          cycle.pausedEventRemainingMs &&
          cycle.pausedEventRemainingMs > 0 &&
          cycle.pausedEventDownloadMultiplier !== null &&
          cycle.pausedEventUploadMultiplier !== null
        ) {
          const resumeId = randomUUID();
          const resumeEnds = new Date(
            now.getTime() + cycle.pausedEventRemainingMs
          );
          if (!(await hasOverlap(now, resumeEnds, undefined, tx))) {
            await tx.insert(schema.bonusEvents).values({
              id: resumeId,
              title: cycle.pausedEventTitle ?? 'Bonus event (resumed)',
              description: cycle.pausedEventDescription,
              longDescription: cycle.pausedEventLongDescription,
              downloadMultiplier: cycle.pausedEventDownloadMultiplier,
              uploadMultiplier: cycle.pausedEventUploadMultiplier,
              startsAt: now,
              endsAt: resumeEnds,
              enabled: true,
              source: 'manual',
              createdById: cycle.pausedEventCreatedById,
            });
          }
        }

        await tx
          .update(schema.freeleechPoolCycles)
          .set({ status: 'ended', closedAt: now })
          .where(eq(schema.freeleechPoolCycles.id, cycle.id));

        // Open a fresh cycle only when the feature is still enabled.
        if (config.enabled && config.pointsTarget > 0) {
          await tx.insert(schema.freeleechPoolCycles).values({
            id: randomUUID(),
            status: 'filling',
            targetSnapshot: config.pointsTarget,
            durationDaysSnapshot: config.freeleechDurationDays,
          });
        }
      });
      ended++;
    } catch (err) {
      console.warn(
        '[FreeleechPool] tickEndExpired failed for',
        cycle.id,
        (err as Error).message
      );
    }
    await syncActiveSnapshot();
  }
  return ended;
}

// ── Admin reset ────────────────────────────────────────────────────

/** Drain the pool: cancel the current cycle (any state), drop the
 *  triggered bonus event if still running, and *do not* refund
 *  contributors. The product spec is explicit on this — pool
 *  contributions are donations.
 *
 *  Used by the admin's manual reset button. Idempotent: a no-op
 *  when there's no open cycle. */
export async function adminReset(): Promise<{ cancelled: boolean }> {
  const now = new Date();
  return db.transaction(async (tx) => {
    await lockPoolForWrite(tx);
    await lockBonusEventsForWrite(tx);

    const [open] = await tx
      .select()
      .from(schema.freeleechPoolCycles)
      .where(sql`status IN ('filling', 'full_queued', 'active')`)
      .limit(1);
    if (!open) return { cancelled: false };

    if (open.triggeredEventId) {
      await tx
        .update(schema.bonusEvents)
        .set({ enabled: false, updatedAt: now })
        .where(eq(schema.bonusEvents.id, open.triggeredEventId));
    }
    await tx
      .update(schema.freeleechPoolCycles)
      .set({ status: 'cancelled', closedAt: now })
      .where(eq(schema.freeleechPoolCycles.id, open.id));

    return { cancelled: true };
  });
}

// ── Public-facing snapshot ─────────────────────────────────────────

export interface PoolPublicState {
  enabled: boolean;
  isOpen: boolean;
  config: {
    pointsTarget: number;
    freeleechDurationDays: number;
    contributionMin: number;
    maxPerUserBp: number;
    presetAmounts: number[];
  };
  cycle: {
    id: string;
    status: PoolStatus;
    targetSnapshot: number;
    durationDaysSnapshot: number;
    totalContributed: number;
    startedAt: string | null;
    endsAt: string | null;
    waitingOnEventId: string | null;
    triggeredEventId: string | null;
  } | null;
  topContributors: Array<{ userId: string; username: string; total: number }>;
  userContribution: number | null;
}

/** Snapshot of the pool state for the user-facing shop widget. */
export async function getPublicState(userId?: string | null): Promise<PoolPublicState> {
  const config = await getConfig();
  const cycle = await getCurrentCycle();
  const open = config.enabled ? await isWindowOpen() : false;
  const top = cycle ? await getTopContributors(cycle.id, 5) : [];
  const userTotal =
    cycle && userId ? await getUserContribution(cycle.id, userId) : null;
  return {
    enabled: config.enabled,
    isOpen: open,
    config: {
      pointsTarget: config.pointsTarget,
      freeleechDurationDays: config.freeleechDurationDays,
      contributionMin: config.contributionMin,
      maxPerUserBp: config.maxPerUserBp,
      presetAmounts: config.presetAmounts,
    },
    cycle: cycle
      ? {
          id: cycle.id,
          status: cycle.status as PoolStatus,
          targetSnapshot: cycle.targetSnapshot,
          durationDaysSnapshot: cycle.durationDaysSnapshot,
          totalContributed: cycle.totalContributed,
          startedAt: cycle.startedAt?.toISOString() ?? null,
          endsAt: cycle.endsAt?.toISOString() ?? null,
          waitingOnEventId: cycle.waitingOnEventId,
          triggeredEventId: cycle.triggeredEventId,
        }
      : null,
    topContributors: top,
    userContribution: userTotal,
  };
}

// ── Validation helpers ─────────────────────────────────────────────

/** Bounds-check a config patch before persisting. Throws a
 *  `FreeleechPoolError` on bad input so the route handler can
 *  forward the status code unchanged. */
export function validateConfigPatch(patch: Partial<PoolConfig>): void {
  if (patch.pointsTarget !== undefined) {
    if (
      !Number.isInteger(patch.pointsTarget) ||
      patch.pointsTarget < 0 ||
      patch.pointsTarget > POINTS_TARGET_MAX
    ) {
      throw new FreeleechPoolError(400, 'pointsTarget out of range');
    }
  }
  if (patch.freeleechDurationDays !== undefined) {
    if (
      !Number.isInteger(patch.freeleechDurationDays) ||
      patch.freeleechDurationDays < 1 ||
      patch.freeleechDurationDays > DURATION_DAYS_MAX
    ) {
      throw new FreeleechPoolError(400, 'freeleechDurationDays out of range');
    }
  }
  if (patch.contributionMin !== undefined) {
    if (
      !Number.isInteger(patch.contributionMin) ||
      patch.contributionMin < 1
    ) {
      throw new FreeleechPoolError(400, 'contributionMin must be >= 1');
    }
  }
  if (patch.maxPerUserBp !== undefined) {
    if (
      !Number.isInteger(patch.maxPerUserBp) ||
      patch.maxPerUserBp < 0 ||
      patch.maxPerUserBp > MAX_PER_USER_BP_MAX
    ) {
      throw new FreeleechPoolError(400, 'maxPerUserBp out of range');
    }
  }
  if (patch.presetAmounts !== undefined) {
    if (!Array.isArray(patch.presetAmounts)) {
      throw new FreeleechPoolError(400, 'presetAmounts must be an array');
    }
    for (const a of patch.presetAmounts) {
      if (!Number.isInteger(a) || a <= 0) {
        throw new FreeleechPoolError(
          400,
          'presetAmounts entries must be positive integers'
        );
      }
    }
  }
}

