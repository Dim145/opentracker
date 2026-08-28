/**
 * GET /api/admin/fonts — the uploaded faces, for the theme editor's pickers.
 *
 * Administrator, not owner. Only the owner may upload one, but any administrator
 * authoring a theme has to be able to select one, and a picker that cannot list
 * its options is not a picker.
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import { listFonts, MAX_FONT_BYTES } from '~~/utils/fonts';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  return { fonts: await listFonts(), maxBytes: MAX_FONT_BYTES };
});
