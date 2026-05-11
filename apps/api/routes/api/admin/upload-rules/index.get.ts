/**
 * GET /api/admin/upload-rules
 *
 * Admin-only — returns the full upload-rules snapshot used by the
 * admin form. Same shape as the public endpoint at
 * `/api/upload-rules`, but always returns the live values from the
 * cache (no filtering of fields).
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import { getUploadRules } from '~~/utils/uploadRules';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  return await getUploadRules();
});
