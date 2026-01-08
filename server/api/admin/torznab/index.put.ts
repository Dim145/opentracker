/**
 * PUT /api/admin/torznab
 * Update Torznab API configuration (admin only)
 */

import { z } from 'zod';
import { requireAdminSession } from '../../../utils/adminAuth';
import {
  setTorznabEnabled,
  setTorznabRateLimitSearch,
  setTorznabRateLimitDownload,
  setTorznabRateLimitWindow,
  setTorznabEnableLogging,
  setTorznabAllowedCategories,
} from '../../../utils/torznabSettings';

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  rateLimitSearch: z.number().min(1).max(1000).optional(),
  rateLimitDownload: z.number().min(1).max(500).optional(),
  rateLimitWindow: z.number().min(10).max(3600).optional(),
  enableLogging: z.boolean().optional(),
  allowedCategories: z.array(z.string()).optional(),
});

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const body = await readBody(event);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: parsed.error.issues,
    });
  }

  const updates = parsed.data;

  // Apply updates
  if (updates.enabled !== undefined) {
    await setTorznabEnabled(updates.enabled);
  }

  if (updates.rateLimitSearch !== undefined) {
    await setTorznabRateLimitSearch(updates.rateLimitSearch);
  }

  if (updates.rateLimitDownload !== undefined) {
    await setTorznabRateLimitDownload(updates.rateLimitDownload);
  }

  if (updates.rateLimitWindow !== undefined) {
    await setTorznabRateLimitWindow(updates.rateLimitWindow);
  }

  if (updates.enableLogging !== undefined) {
    await setTorznabEnableLogging(updates.enableLogging);
  }

  if (updates.allowedCategories !== undefined) {
    await setTorznabAllowedCategories(updates.allowedCategories);
  }

  return { success: true };
});
