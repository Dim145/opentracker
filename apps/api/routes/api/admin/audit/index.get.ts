/**
 * GET /api/admin/audit — the staff register, read.
 *
 * ## Admins only, and moderators deliberately not
 *
 * `requireAdminSession`, not `requireModeratorSession`, even though moderator
 * actions are what fills the table. A register read by everyone it registers is
 * a register people write around: knowing exactly what your colleague can see
 * about you changes what you do in front of them, and the value of an audit log
 * is that it is read by the people accountable for the console, not by everyone
 * with a key to it. The instance owner is an admin, so they are covered.
 *
 * ## Filters
 *
 * Four, and each has an index behind it (see the table): actor, action, target,
 * and a date range. `q` is a free-text pass over actor name and target label —
 * deliberately not over `changes`, whose JSON would need a GIN index nobody has
 * asked for yet, and whose contents are the part most likely to hold a value
 * that should not be searchable in bulk.
 *
 * ## What it does not do
 *
 * There is no write, no edit and no delete route beside this one. Rows leave
 * only through the retention sweep (`plugins/audit-retention.ts`).
 */
import { and, count, desc, eq, gte, ilike, lte, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { escapeLike } from '~~/utils/sql';
import { validateQuery } from '~~/utils/schemas';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  /** Filter to one staffer. */
  actorId: z.string().min(1).max(64).optional(),
  /** Exact action key, e.g. `user.ban`. */
  action: z.string().min(1).max(128).optional(),
  targetType: z.string().min(1).max(64).optional(),
  targetId: z.string().min(1).max(128).optional(),
  /** Free text over actor name and target label. */
  q: z.string().min(1).max(128).optional(),
  /** ISO dates, inclusive. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** `true` keeps only entries whose request did not succeed. */
  failuresOnly: z
    .union([z.literal('true'), z.literal('false')])
    .optional()
    .transform((v) => v === 'true'),
});

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const params = validateQuery(event, querySchema);

  const conditions: SQL[] = [];
  if (params.actorId) {
    conditions.push(eq(schema.auditLog.actorId, params.actorId));
  }
  if (params.action) {
    conditions.push(eq(schema.auditLog.action, params.action));
  }
  if (params.targetType) {
    conditions.push(eq(schema.auditLog.targetType, params.targetType));
  }
  if (params.targetId) {
    conditions.push(eq(schema.auditLog.targetId, params.targetId));
  }
  if (params.from) {
    conditions.push(gte(schema.auditLog.createdAt, params.from));
  }
  if (params.to) {
    conditions.push(lte(schema.auditLog.createdAt, params.to));
  }
  if (params.failuresOnly) {
    // Anything outside 2xx. A 403 run from one account is the signal this
    // table exists for, so failures are first-class rather than noise.
    conditions.push(
      or(
        lte(schema.auditLog.statusCode, 199),
        gte(schema.auditLog.statusCode, 300)
      )!
    );
  }
  if (params.q) {
    const needle = `%${escapeLike(params.q)}%`;
    conditions.push(
      or(
        ilike(schema.auditLog.actorName, needle),
        ilike(schema.auditLog.targetLabel, needle)
      )!
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ value: total } = { value: 0 }]] = await Promise.all([
    db
      .select()
      .from(schema.auditLog)
      .where(where)
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
    db.select({ value: count() }).from(schema.auditLog).where(where),
  ]);

  return {
    items: rows,
    total,
    page: params.page,
    pageSize: params.pageSize,
  };
});
