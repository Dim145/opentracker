/**
 * GET /api/privacy
 *
 * What this instance keeps, and for how long — as it is configured right
 * now, not as a page once wrote down.
 *
 * Public, and deliberately so: a retention period nobody can read is a
 * retention period nobody was told about, and telling people is the point
 * of having one. It carries settings and nothing about any member, which
 * is what lets it answer before a session exists.
 *
 * Read live rather than duplicated into prose. The alternative is a page
 * that says fourteen days while the sweep runs on thirty, and the drift
 * is invisible until somebody checks.
 */
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import {
  getDmRetentionDays,
  getMessagingDmScope,
  getMessagingRoomScope,
  getNotificationsRetentionReadDays,
  getNotificationsRetentionUnreadDays,
  getRoomRetentionDays,
} from '~~/utils/settings';

export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.public);

  const [
    dmScope,
    roomScope,
    directMessageDays,
    roomMessageDays,
    notificationsReadDays,
    notificationsUnreadDays,
  ] = await Promise.all([
    getMessagingDmScope(),
    getMessagingRoomScope(),
    getDmRetentionDays(),
    getRoomRetentionDays(),
    getNotificationsRetentionReadDays(),
    getNotificationsRetentionUnreadDays(),
  ]);

  return {
    messaging: {
      directMessages: dmScope !== 'off',
      room: roomScope !== 'off',
      /** Days, or 0 — kept until a participant deletes them. */
      directMessageDays,
      roomMessageDays,
    },
    notifications: { notificationsReadDays, notificationsUnreadDays },
  };
});
