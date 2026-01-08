/**
 * GET /api/admin/torznab/stats
 * Get detailed Torznab API statistics (admin only)
 */

import { requireAdminSession } from '../../../utils/adminAuth';
import {
  getTorznabStats,
  getTorznabTopUsers,
  getTorznabRequestsByHour,
  getTorznabRateLimitHits,
} from '../../../utils/torznabStats';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const [stats, topUsers, requestsByHour, rateLimitHits] = await Promise.all([
    getTorznabStats(),
    getTorznabTopUsers(10),
    getTorznabRequestsByHour(24),
    getTorznabRateLimitHits(),
  ]);

  return {
    stats,
    topUsers,
    requestsByHour,
    rateLimitHits,
  };
});
