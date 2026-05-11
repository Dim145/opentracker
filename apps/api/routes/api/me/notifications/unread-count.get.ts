/**
 * GET /api/me/notifications/unread-count
 *
 * Cheap dedicated endpoint for the bell badge. Useful when the
 * SSE stream is interrupted (mobile network flip, proxy timeout) —
 * the frontend can fall back to polling this endpoint at a low
 * cadence without paying the bandwidth cost of the full list.
 */
import { getUnreadCount } from '~~/utils/notify';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const count = await getUnreadCount(user.id);
  return { count };
});
