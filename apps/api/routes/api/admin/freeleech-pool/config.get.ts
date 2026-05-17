/**
 * GET /api/admin/freeleech-pool/config — singleton config row.
 *
 * The service auto-upserts the row on first read so the admin
 * panel always renders a defined state.
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import { getConfig } from '~~/utils/freeleechPool';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const config = await getConfig();
  return { config };
});
