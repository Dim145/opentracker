/**
 * Role auto-assignment engine — multi-role variant.
 *
 * Each row in `user_roles` represents one attached role on a user.
 * A row carries:
 *   - assignedAt: when the role landed (engine sweep timestamp or
 *     admin attach time)
 *   - assignedManually: true when an admin attached it from the user
 *     registry. The engine never deletes manual rows even if the
 *     user no longer matches the role's rules.
 *
 * Auto roles are owned by the engine. On every sweep we INSERT one
 * row per matching auto role that isn't already attached, and DELETE
 * any auto row whose role's rules the user no longer satisfies. Manual
 * rows are never touched.
 *
 * The combinator + condition shape (RuleSet) is unchanged from the
 * single-role version — just the assignment storage moved.
 */

import { db, schema } from '@trackarr/db';
import { eq, sql, and as drizzleAnd, inArray, notInArray } from 'drizzle-orm';

export type RuleField =
  | 'approvedUploads'
  | 'totalUploads'
  | 'ratio'
  | 'uploadedBytes'
  | 'downloadedBytes'
  | 'accountAgeDays'
  | 'hnrCount'
  | 'completedSeeds';

export type RuleComparator = 'gte' | 'gt' | 'lte' | 'lt' | 'eq';

export interface RuleCondition {
  field: RuleField;
  comparator: RuleComparator;
  value: number;
}

export interface RuleSet {
  combinator: 'and' | 'or';
  conditions: RuleCondition[];
}

export const RULE_FIELDS: ReadonlyArray<RuleField> = [
  'approvedUploads',
  'totalUploads',
  'ratio',
  'uploadedBytes',
  'downloadedBytes',
  'accountAgeDays',
  'hnrCount',
  'completedSeeds',
];

export const RULE_COMPARATORS: ReadonlyArray<RuleComparator> = [
  'gte',
  'gt',
  'lte',
  'lt',
  'eq',
];

export interface UserStats {
  approvedUploads: number;
  totalUploads: number;
  ratio: number;
  uploadedBytes: number;
  downloadedBytes: number;
  accountAgeDays: number;
  hnrCount: number;
  completedSeeds: number;
}

/**
 * Compute the full UserStats payload for a user. Cheap: each subquery
 * is an indexed COUNT/aggregate. Returns null when the user doesn't
 * exist.
 */
export async function computeUserStats(
  userId: string
): Promise<UserStats | null> {
  const [user] = await db
    .select({
      uploadedBytes: schema.users.uploaded,
      downloadedBytes: schema.users.downloaded,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) return null;

  const [agg] = await db
    .select({
      approvedUploads: sql<number>`count(*) FILTER (WHERE ${schema.torrents.uploaderId} = ${userId} AND ${schema.torrents.isApproved} = true)::int`,
      totalUploads: sql<number>`count(*) FILTER (WHERE ${schema.torrents.uploaderId} = ${userId})::int`,
    })
    .from(schema.torrents);

  const [hnrAgg] = await db
    .select({
      hnrCount: sql<number>`count(*) FILTER (WHERE ${schema.hnrTracking.isHnr} = true)::int`,
      completedSeeds: sql<number>`count(*) FILTER (WHERE ${schema.hnrTracking.completedAt} IS NOT NULL)::int`,
    })
    .from(schema.hnrTracking)
    .where(eq(schema.hnrTracking.userId, userId));

  const downloaded = Number(user.downloadedBytes ?? 0);
  const uploaded = Number(user.uploadedBytes ?? 0);
  const ratio =
    downloaded === 0
      ? uploaded > 0
        ? Number.POSITIVE_INFINITY
        : 0
      : uploaded / downloaded;
  const ageMs = Date.now() - new Date(user.createdAt).getTime();
  return {
    approvedUploads: agg?.approvedUploads ?? 0,
    totalUploads: agg?.totalUploads ?? 0,
    ratio,
    uploadedBytes: uploaded,
    downloadedBytes: downloaded,
    accountAgeDays: Math.max(0, Math.floor(ageMs / 86_400_000)),
    hnrCount: hnrAgg?.hnrCount ?? 0,
    completedSeeds: hnrAgg?.completedSeeds ?? 0,
  };
}

function evalCondition(c: RuleCondition, stats: UserStats): boolean {
  const lhs = stats[c.field];
  if (typeof lhs !== 'number') return false;
  const rhs = c.value;
  if (typeof rhs !== 'number' || !Number.isFinite(rhs)) return false;
  switch (c.comparator) {
    case 'gte':
      return lhs >= rhs;
    case 'gt':
      return lhs > rhs;
    case 'lte':
      return lhs <= rhs;
    case 'lt':
      return lhs < rhs;
    case 'eq':
      return lhs === rhs;
    default:
      return false;
  }
}

export function evaluateRuleSet(
  ruleset: RuleSet | null | undefined,
  stats: UserStats
): boolean {
  if (
    !ruleset ||
    !Array.isArray(ruleset.conditions) ||
    ruleset.conditions.length === 0
  ) {
    return false;
  }
  if (ruleset.combinator === 'or') {
    return ruleset.conditions.some((c) => evalCondition(c, stats));
  }
  return ruleset.conditions.every((c) => evalCondition(c, stats));
}

interface SweepDelta {
  added: string[]; // role ids attached on this sweep
  removed: string[]; // role ids detached
}

/**
 * Recompute auto-role attachments for a single user.
 *
 * The engine only owns rows where assignedManually = false. It will:
 *   - INSERT a row for every auto role that matches the user and
 *     isn't already attached.
 *   - DELETE any auto-owned row whose rule no longer matches.
 *   - Leave manual rows entirely alone.
 *
 * Banned users are skipped — letting bans clear all auto badges feels
 * like the right semantics for a moderation event.
 */
export async function reevaluateUserRole(
  userId: string
): Promise<SweepDelta> {
  const [user] = await db
    .select({ id: schema.users.id, isBanned: schema.users.isBanned })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user || user.isBanned) {
    return { added: [], removed: [] };
  }

  const stats = await computeUserStats(userId);
  if (!stats) return { added: [], removed: [] };

  const autoRoles = await db
    .select({
      id: schema.roles.id,
      rules: schema.roles.rules,
    })
    .from(schema.roles)
    .where(eq(schema.roles.assignmentMode, 'auto'));

  const matching = new Set<string>();
  for (const role of autoRoles) {
    if (evaluateRuleSet(role.rules as RuleSet | null, stats)) {
      matching.add(role.id);
    }
  }

  // Read current attachments grouped by ownership: only auto rows are
  // ours to mutate; manual rows are frozen.
  const current = await db
    .select({
      roleId: schema.userRoles.roleId,
      assignedManually: schema.userRoles.assignedManually,
    })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, userId));

  const ownedAuto = new Set(
    current.filter((r) => !r.assignedManually).map((r) => r.roleId)
  );
  const allCurrent = new Set(current.map((r) => r.roleId));

  // Roles that match but aren't attached at all yet → INSERT
  const toAdd: string[] = [];
  for (const id of matching) {
    if (!allCurrent.has(id)) toAdd.push(id);
  }

  // Roles we own (auto, no manual freeze) but no longer match → DELETE
  const toRemove: string[] = [];
  for (const id of ownedAuto) {
    if (!matching.has(id)) toRemove.push(id);
  }

  if (toAdd.length > 0) {
    await db
      .insert(schema.userRoles)
      .values(
        toAdd.map((roleId) => ({
          userId,
          roleId,
          assignedManually: false,
        }))
      )
      .onConflictDoNothing();
  }
  if (toRemove.length > 0) {
    await db
      .delete(schema.userRoles)
      .where(
        drizzleAnd(
          eq(schema.userRoles.userId, userId),
          inArray(schema.userRoles.roleId, toRemove),
          eq(schema.userRoles.assignedManually, false)
        )!
      );
  }

  return { added: toAdd, removed: toRemove };
}

/**
 * Recompute every non-banned user. Used by the periodic sweep + the
 * admin "Recompute now" button. Manual rows are still left alone — the
 * function only touches auto-owned rows.
 */
export async function reevaluateAllUsers(): Promise<{
  considered: number;
  attached: number;
  detached: number;
}> {
  const candidates = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.isBanned, false));

  let attached = 0;
  let detached = 0;
  for (const u of candidates) {
    const delta = await reevaluateUserRole(u.id);
    attached += delta.added.length;
    detached += delta.removed.length;
  }
  return {
    considered: candidates.length,
    attached,
    detached,
  };
}
