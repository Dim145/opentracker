/**
 * POST /api/me/notifications/:id/read
 *
 * Mark a single notification as read. Idempotent — re-marking an
 * already-read row is a 200 with `changed: false` rather than a
 * 4xx, so the UI's "tap to read" gesture stays cheap.
 */
import { markNotificationRead } from '~~/utils/notify';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing notification id' });
  }
  const changed = await markNotificationRead(user.id, id);
  return { success: true, changed };
});
