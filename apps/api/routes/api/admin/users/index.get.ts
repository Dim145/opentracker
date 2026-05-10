/**
 * GET /api/admin/users
 *
 * Powers the operator user-registry page. The previous implementation
 * was search-only and capped at 10 results — useful for quick lookups,
 * useless for any actual moderation work. This now returns a fully
 * paginated, filterable and sortable list along with a small stats
 * payload so the operator can see the population at a glance.
 *
 * Query shape (all optional):
 *   search   — username substring (ILIKE)
 *   page     — 1-based page number; default 1
 *   pageSize — 1..100; default 25
 *   sort     — username | createdAt | lastSeen | uploaded | downloaded | ratio
 *   dir      — asc | desc; default desc
 *   banned   — true | false (filter)
 *   admin    — true | false
 *   mod      — true | false
 *   role     — role uuid, or "none" to find role-less users
 *   activity — online (≤5min) | active (≤24h) | idle (>30d) | never
 *
 * Returns:
 *   { items, total, page, pageSize, stats }
 *
 * Auth: moderator+ (matches the original endpoint).
 */
import { db } from '@trackarr/db';
import { users, userRoles, roles } from '@trackarr/db/schema';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { fingerprintIP } from '~~/utils/crypto';
import { escapeLike } from '~~/utils/sql';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  notInArray,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';

const ternary = z.enum(['true', 'false']).optional();
const querySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z
    .enum([
      'username',
      'createdAt',
      'lastSeen',
      'uploaded',
      'downloaded',
      'ratio',
    ])
    .default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
  banned: ternary,
  admin: ternary,
  mod: ternary,
  role: z.string().max(64).optional(),
  activity: z.enum(['online', 'active', 'idle', 'never']).optional(),
});

export default defineEventHandler(async (event) => {
  const { user: viewer } = await requireModeratorSession(event);
  const params = querySchema.parse(getQuery(event));

  // ── WHERE clause ─────────────────────────────────────────────
  const conditions: SQL[] = [];
  if (params.search) {
    conditions.push(ilike(users.username, `%${escapeLike(params.search)}%`));
  }
  if (params.banned === 'true') conditions.push(eq(users.isBanned, true));
  if (params.banned === 'false') conditions.push(eq(users.isBanned, false));
  if (params.admin === 'true') conditions.push(eq(users.isAdmin, true));
  if (params.admin === 'false') conditions.push(eq(users.isAdmin, false));
  if (params.mod === 'true') conditions.push(eq(users.isModerator, true));
  if (params.mod === 'false') conditions.push(eq(users.isModerator, false));
  if (params.role === 'none') {
    // Users with no role → not present in user_roles at all.
    conditions.push(
      notInArray(
        users.id,
        db
          .select({ id: userRoles.userId })
          .from(userRoles)
      )!
    );
  } else if (params.role) {
    // Users carrying a specific role → present in user_roles with
    // that roleId.
    conditions.push(
      inArray(
        users.id,
        db
          .select({ id: userRoles.userId })
          .from(userRoles)
          .where(eq(userRoles.roleId, params.role))
      )!
    );
  }
  // Activity is computed against `lastSeen`. The `never` bucket needs a
  // tolerance because lastSeen defaults to now() at registration and then
  // gets bumped on every authenticated request — a freshly-created
  // account that never logged back in will have lastSeen ≈ createdAt.
  if (params.activity === 'online') {
    conditions.push(gte(users.lastSeen, sql`now() - interval '5 minutes'`));
  } else if (params.activity === 'active') {
    conditions.push(gte(users.lastSeen, sql`now() - interval '24 hours'`));
  } else if (params.activity === 'idle') {
    conditions.push(lte(users.lastSeen, sql`now() - interval '30 days'`));
  } else if (params.activity === 'never') {
    conditions.push(
      sql`${users.lastSeen} <= ${users.createdAt} + interval '1 minute'`
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // ── Sort column ──────────────────────────────────────────────
  // Ratio is a derived value — we order by an SQL fraction with a
  // GREATEST(downloaded, 1) guard so users with zero downloads end up
  // ranked by their raw upload bytes (effectively "infinity ratio,
  // tiebroken by volume").
  const sortColumn = (() => {
    switch (params.sort) {
      case 'username':
        return users.username;
      case 'lastSeen':
        return users.lastSeen;
      case 'uploaded':
        return users.uploaded;
      case 'downloaded':
        return users.downloaded;
      case 'ratio':
        return sql`CAST(${users.uploaded} AS DOUBLE PRECISION) / GREATEST(${users.downloaded}, 1)`;
      case 'createdAt':
      default:
        return users.createdAt;
    }
  })();
  const orderBy = params.dir === 'asc' ? asc(sortColumn) : desc(sortColumn);

  // ── Page slice + total + global stats in parallel ────────────
  const [
    items,
    [{ value: total } = { value: 0 }],
    [{ value: totalAll } = { value: 0 }],
    [{ value: bannedCount } = { value: 0 }],
    [{ value: adminCount } = { value: 0 }],
    [{ value: modCount } = { value: 0 }],
    [{ value: activeCount } = { value: 0 }],
    [{ value: onlineCount } = { value: 0 }],
  ] = await Promise.all([
    db.query.users.findMany({
      where: whereClause,
      orderBy,
      limit: params.pageSize,
      offset: (params.page - 1) * params.pageSize,
      columns: {
        id: true,
        username: true,
        isAdmin: true,
        isModerator: true,
        isBanned: true,
        lastIp: true,
        uploaded: true,
        downloaded: true,
        invitesRemaining: true,
        bonusPoints: true,
        createdAt: true,
        lastSeen: true,
      },
    }),
    db.select({ value: count() }).from(users).where(whereClause),
    db.select({ value: count() }).from(users),
    db
      .select({ value: count() })
      .from(users)
      .where(eq(users.isBanned, true)),
    db
      .select({ value: count() })
      .from(users)
      .where(eq(users.isAdmin, true)),
    db
      .select({ value: count() })
      .from(users)
      .where(eq(users.isModerator, true)),
    db
      .select({ value: count() })
      .from(users)
      .where(gte(users.lastSeen, sql`now() - interval '24 hours'`)),
    db
      .select({ value: count() })
      .from(users)
      .where(gte(users.lastSeen, sql`now() - interval '5 minutes'`)),
  ]);

  // ── Roles per user (single follow-up query) ─────────────────
  // We fetch every attachment for the page slice in one shot then
  // bucket by userId. The list is ordered by role.priority desc so
  // the highest-priority chip renders first in the UI.
  const pageUserIds = items.map((u) => u.id);
  const roleRows = pageUserIds.length
    ? await db
        .select({
          userId: userRoles.userId,
          assignedAt: userRoles.assignedAt,
          assignedManually: userRoles.assignedManually,
          role: {
            id: roles.id,
            name: roles.name,
            color: roles.color,
            icon: roles.icon,
            priority: roles.priority,
            assignmentMode: roles.assignmentMode,
            showAsBadge: roles.showAsBadge,
          },
        })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(inArray(userRoles.userId, pageUserIds))
        .orderBy(desc(roles.priority))
    : [];
  const rolesByUser = new Map<string, typeof roleRows>();
  for (const row of roleRows) {
    const arr = rolesByUser.get(row.userId);
    if (arr) arr.push(row);
    else rolesByUser.set(row.userId, [row]);
  }

  // ── lastIp visibility per viewer level ──────────────────────
  // Admins see the raw IP for ban/forensics. Moderators see a stable
  // hash so they can spot multi-account abuse from a single IP
  // without ever holding the IP itself. Plain users would never reach
  // this route — the requireModeratorSession check above already
  // gated it.
  const projected = items.map((u) => {
    const userRoleList = (rolesByUser.get(u.id) ?? []).map((r) => ({
      ...r.role,
      assignedAt: r.assignedAt,
      assignedManually: r.assignedManually,
    }));
    if (viewer.isAdmin) {
      return { ...u, lastIpHash: null, roles: userRoleList };
    }
    // Moderator path: replace `lastIp` with the fingerprint and drop
    // the raw value entirely.
    const { lastIp, ...rest } = u;
    return {
      ...rest,
      lastIp: null,
      lastIpHash: lastIp ? fingerprintIP(lastIp) : null,
      roles: userRoleList,
    };
  });

  return {
    items: projected,
    total,
    page: params.page,
    pageSize: params.pageSize,
    stats: {
      total: totalAll,
      banned: bannedCount,
      admins: adminCount,
      moderators: modCount,
      activeLast24h: activeCount,
      onlineNow: onlineCount,
    },
  };
});
