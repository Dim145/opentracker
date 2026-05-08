/**
 * GET /api/admin/banned-ips
 *
 * Paginated list of `banned_ips` entries used by the new admin
 * blocklist page. The auth/login + auth/register routes already check
 * this table on every request, so this endpoint is purely a moderator
 * read view — adding / removing bans is handled by the sibling
 * routes.
 *
 * Query (all optional):
 *   search    — substring match against ip OR reason
 *   page      — 1-based, default 1
 *   pageSize  — 1..100, default 25
 *   sort      — 'createdAt' | 'ip' (default createdAt)
 *   dir       — 'asc' | 'desc' (default desc)
 *
 * Returns:
 *   { items, total, page, pageSize, stats: { total, today, week,
 *     manual, automatic } }
 *
 * Stats are useful at-a-glance aggregates so the admin page can show
 * a KPI strip without round-tripping per metric. "Manual" vs
 * "automatic" is derived from the `reason` prefix — auto bans set by
 * `users/[id]/ban` start with the literal `Banned user:` token.
 *
 * Auth: moderator+ matches the rest of the admin/* tree.
 */
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { escapeLike } from '~~/utils/sql';
import {
  and,
  asc,
  count,
  desc,
  gte,
  ilike,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';

const querySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['createdAt', 'ip']).default('createdAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});

// Auto-bans set by `users/[id]/ban.post.ts` carry this prefix in the
// `reason` column. Anything else is treated as a manual operator ban.
const AUTO_PREFIX = 'Banned user:';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  const params = querySchema.parse(getQuery(event));

  const conditions: SQL[] = [];
  if (params.search) {
    const pattern = `%${escapeLike(params.search)}%`;
    conditions.push(
      // search across both ip and reason for fast-find from a partial
      // input — the moderator usually knows one or the other.
      or(
        ilike(schema.bannedIps.ip, pattern),
        ilike(schema.bannedIps.reason, pattern)
      )!
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const sortColumn =
    params.sort === 'ip' ? schema.bannedIps.ip : schema.bannedIps.createdAt;
  const orderBy = params.dir === 'asc' ? asc(sortColumn) : desc(sortColumn);

  const [
    items,
    [{ value: total } = { value: 0 }],
    [{ value: totalAll } = { value: 0 }],
    [{ value: today } = { value: 0 }],
    [{ value: week } = { value: 0 }],
    [{ value: manualCount } = { value: 0 }],
  ] = await Promise.all([
    db.query.bannedIps.findMany({
      where,
      orderBy,
      limit: params.pageSize,
      offset: (params.page - 1) * params.pageSize,
    }),
    db.select({ value: count() }).from(schema.bannedIps).where(where),
    db.select({ value: count() }).from(schema.bannedIps),
    db
      .select({ value: count() })
      .from(schema.bannedIps)
      .where(gte(schema.bannedIps.createdAt, sql`now() - interval '24 hours'`)),
    db
      .select({ value: count() })
      .from(schema.bannedIps)
      .where(gte(schema.bannedIps.createdAt, sql`now() - interval '7 days'`)),
    db
      .select({ value: count() })
      .from(schema.bannedIps)
      .where(
        sql`${schema.bannedIps.reason} IS NULL OR ${schema.bannedIps.reason} NOT LIKE ${AUTO_PREFIX + '%'}`
      ),
  ]);

  return {
    items: items.map((row) => ({
      ip: row.ip,
      reason: row.reason,
      createdAt: row.createdAt,
      // Inferred for the UI — saves a per-row computation client-side.
      automatic: !!row.reason && row.reason.startsWith(AUTO_PREFIX),
    })),
    total,
    page: params.page,
    pageSize: params.pageSize,
    stats: {
      total: totalAll,
      today,
      week,
      manual: manualCount,
      automatic: totalAll - manualCount,
    },
  };
});
