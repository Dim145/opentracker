/**
 * GET /api/admin/torznab/logs
 * Get Torznab API request logs with pagination (admin only)
 */

import { requireAdminSession } from '../../../utils/adminAuth';
import {
  getTorznabRecentLogs,
  getTorznabLogsByUser,
} from '../../../utils/torznabStats';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const query = getQuery(event);
  const limit = Math.min(parseInt(query.limit as string) || 50, 100);
  const offset = parseInt(query.offset as string) || 0;
  const passkey = query.passkey as string | undefined;

  let result;
  if (passkey) {
    result = await getTorznabLogsByUser(passkey, limit, offset);
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
