/**
 * GET /api/admin/torznab
 * Get Torznab API configuration and stats (admin only)
 */

import { requireAdminSession } from '~~/utils/adminAuth';
import {
  getTorznabEnabled,
  getTorznabRateLimitSearch,
  getTorznabRateLimitDownload,
  getTorznabRateLimitWindow,
  getTorznabEnableLogging,
  getTorznabAllowedCategories,
  getTorznabIncludeFederated,
} from '~~/utils/torznabSettings';
import { getTorznabStats } from '~~/utils/torznabStats';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const [
    enabled,
    rateLimitSearch,
    rateLimitDownload,
    rateLimitWindow,
    enableLogging,
    allowedCategories,
    includeFederated,
    stats,
  ] = await Promise.all([
    getTorznabEnabled(),
    getTorznabRateLimitSearch(),
    getTorznabRateLimitDownload(),
    getTorznabRateLimitWindow(),
    getTorznabEnableLogging(),
    getTorznabAllowedCategories(),
    getTorznabIncludeFederated(),
    getTorznabStats(),
  ]);

  return {
    config: {
      enabled,
      rateLimitSearch,
      rateLimitDownload,
      rateLimitWindow,
      enableLogging,
      allowedCategories,
      includeFederated,
    },
    stats,
  };
});
