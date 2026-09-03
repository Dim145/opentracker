/**
 * GET /api/admin/audit/actions — the action keys actually present, for the filter.
 *
 * Read from the table rather than from a hard-coded list. The action key of an
 * un-enriched route is derived from its path (`utils/audit.deriveAction`), so a
 * fixed list would be a second inventory of every staff route, maintained by
 * hand, wrong within a release. This one cannot be wrong: it is what is there.
 *
 * Capped, because a derived key includes the path and a misconfigured proxy
 * could in principle produce many — a filter dropdown with 5 000 entries is not
 * a filter. The cap is stated in the response so the UI can say so.
 */
import { desc, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

const LIMIT = 200;

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const rows = await db
    .select({
      action: schema.auditLog.action,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.auditLog)
    .groupBy(schema.auditLog.action)
    .orderBy(desc(sql`count(*)`))
    .limit(LIMIT);

  return { items: rows, limit: LIMIT, truncated: rows.length === LIMIT };
});
