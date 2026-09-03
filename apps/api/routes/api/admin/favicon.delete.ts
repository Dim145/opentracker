import { requireAdminSession } from '~~/utils/adminAuth';
import { setSetting, SETTINGS_KEYS } from '~~/utils/server';
import { getStorage } from '~~/utils/storage';
import { resolveObjectKey } from '~~/utils/storage/keys';

/**
 * DELETE /api/admin/favicon
 *
 * Removes the custom favicon and falls back to the built-in one.
 *
 * This route exists because the console already offered the action and nothing
 * carried it out. The branding form has a remove button next to the favicon
 * preview; it set a local field that no request ever sent — `settings.put.ts`
 * has never known the word "favicon", the only writer being the sibling upload
 * route. So an operator removed the favicon, the form counted one unsaved
 * change, the save reported success, and the favicon was still being served.
 *
 * Symmetrical with the upload in both respects: the setting is cleared and the
 * stored file is deleted, and both are the operator's own upload rather than a
 * shipped asset — `resolveObjectKey` is what makes that an assertion rather
 * than a hope.
 */
export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const { getSiteFavicon } = await import('~~/utils/server');
  const current = await getSiteFavicon();

  await setSetting(SETTINGS_KEYS.SITE_FAVICON, '');
  await setSetting(SETTINGS_KEYS.SITE_FAVICON_SIZE, '');

  if (current && current.startsWith('/uploads/')) {
    const key = resolveObjectKey(current.replace(/^\/uploads\//, ''));
    if (key) {
      try {
        await getStorage().delete(key);
      } catch (err) {
        // The setting is already cleared, which is what the site reads. A file
        // left behind is disk, not behaviour, and failing the request here
        // would tell the operator the removal did not happen when it did.
        console.warn('[Favicon Delete] could not remove the stored file:', err);
      }
    }
  }

  return { success: true };
});
