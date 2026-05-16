/**
 * GET /api/requests
 *
 * Paginated bounty-board listing. Query params:
 *   - status: 'requested' | 'filled' | 'validated' | 'cancelled' (optional)
 *   - mine: '1' restricts to requests the caller created
 *   - categoryId: filter by exact category
 *   - search: free-text on title (split on whitespace, ANDed)
 *   - page, limit
 *
 * The page slice is enriched with the requester's username, the
 * filler's username (when set), and the category name — the FE
 * board reads three columns and avoids per-row round-trips.
 */
import { db, schema } from '@trackarr/db';
import { and, desc, eq, ilike, sql } from 'drizzle-orm';
import { z } from 'zod';
import { escapeLike } from '~~/utils/sql';

const querySchema = z.object({
  status: z
    .enum(['requested', 'filled', 'validated', 'cancelled'])
    .optional(),
  mine: z.coerce.boolean().optional(),
  categoryId: z.string().min(1).max(128).optional(),
  search: z.string().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const query = querySchema.parse(getQuery(event));
  const offset = (query.page - 1) * query.limit;

  const conditions = [];
  if (query.status) {
    conditions.push(eq(schema.uploadRequests.status, query.status));
  }
  if (query.mine) {
    conditions.push(eq(schema.uploadRequests.requesterId, user.id));
  }
  if (query.categoryId) {
    conditions.push(eq(schema.uploadRequests.categoryId, query.categoryId));
  }
  if (query.search) {
    // Split-then-AND — every term must hit. Matches the convention
    // used by the public torrents listing so the bounty board feels
    // consistent with the search bar elsewhere.
    const terms = query.search.split(/\s+/).filter(Boolean);
    for (const term of terms) {
      conditions.push(
        ilike(schema.uploadRequests.title, `%${escapeLike(term)}%`),
      );
    }
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [{ value: total } = { value: 0 }]] = await Promise.all([
    db
      .select({
        id: schema.uploadRequests.id,
        title: schema.uploadRequests.title,
        rewardPoints: schema.uploadRequests.rewardPoints,
        status: schema.uploadRequests.status,
        createdAt: schema.uploadRequests.createdAt,
        filledAt: schema.uploadRequests.filledAt,
        validatedAt: schema.uploadRequests.validatedAt,
        requesterId: schema.uploadRequests.requesterId,
        requesterUsername: schema.users.username,
        categoryId: schema.categories.id,
        categoryName: schema.categories.name,
        categorySlug: schema.categories.slug,
        categoryType: schema.categories.type,
        categoryIcon: schema.categories.icon,
      })
      .from(schema.uploadRequests)
      .innerJoin(
        schema.users,
        eq(schema.uploadRequests.requesterId, schema.users.id),
      )
      .innerJoin(
        schema.categories,
        eq(schema.uploadRequests.categoryId, schema.categories.id),
      )
      .where(where)
      .orderBy(desc(schema.uploadRequests.createdAt))
      .limit(query.limit)
      .offset(offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.uploadRequests)
      .where(where),
  ]);

  const data = rows.map((r) => ({
    id: r.id,
    title: r.title,
    rewardPoints: r.rewardPoints,
    status: r.status,
    createdAt: r.createdAt,
    filledAt: r.filledAt,
    validatedAt: r.validatedAt,
    requester: {
      id: r.requesterId,
      username: r.requesterUsername,
    },
    category: {
      id: r.categoryId,
      name: r.categoryName,
      slug: r.categorySlug,
      type: r.categoryType,
      icon: r.categoryIcon,
    },
  }));

  return {
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
    },
  };
});
