/**
 * GET /api/admin/torznab/logs
 *
 * Admin-only Torznab request logs with pagination. Filtering by user
 * takes a `userId` (not a passkey) — the previous shape accepted a
 * raw `passkey` query param, which let an admin enumerate any user's
 * logs by guessing the credential. Now we resolve userId → passkey
 * server-side and hash it before reading the bucket.
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import {
  getTorznabRecentLogs,
  getTorznabLogsByUser,
} from '~~/utils/torznabStats';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const query = getQuery(event);
  const limit = Math.min(parseInt(query.limit as string) || 50, 100);
  const offset = parseInt(query.offset as string) || 0;
  const userId =
    typeof query.userId === 'string' && query.userId ? query.userId : null;

  let result;
  if (userId) {
    const [row] = await db
      .select({ passkey: schema.users.passkey })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!row) {
      throw createError({ statusCode: 404, message: 'User not found' });
    }
    result = await getTorznabLogsByUser(row.passkey, limit, offset);
  } else {
    result = await getTorznabRecentLogs(limit, offset);
  }

  return {
    logs: result.logs,
    total: result.total,
    limit,
    offset,
  };
});
