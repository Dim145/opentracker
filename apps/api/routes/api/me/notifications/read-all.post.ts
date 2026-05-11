/**
 * POST /api/me/notifications/read-all
 *
 * Mark every unread notification of the caller as read in one
 * round-trip. Returns the count of rows mutated for the toast
 * label ("3 notifications marked as read"). Cheap on Postgres
 * thanks to the partial unread index.
 */
import { markAllNotificationsRead } from '~~/utils/notify';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const updated = await markAllNotificationsRead(user.id);
  return { success: true, updated };
});
