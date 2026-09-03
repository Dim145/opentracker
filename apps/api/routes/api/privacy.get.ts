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
  getAuditRetentionDays,
  getLoginEventRetentionDays,
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
    auditDays,
    loginDays,
  ] = await Promise.all([
    getMessagingDmScope(),
    getMessagingRoomScope(),
    getDmRetentionDays(),
    getRoomRetentionDays(),
    getNotificationsRetentionReadDays(),
    getNotificationsRetentionUnreadDays(),
    getAuditRetentionDays(),
    getLoginEventRetentionDays(),
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
    /**
     * The staff audit log. Published for the same reason every other period
     * here is: a retention nobody can read is a retention nobody was told
     * about. What it records is staff actions, not member browsing — but a
     * member who was banned, warned or had their upload rejected IS the target
     * of one of those rows, so the period is theirs to know.
     *
     * `0` means kept indefinitely.
     */
    staffAudit: { retentionDays: auditDays },
    /**
     * The login history. A member's own record of where their account has been
     * used from — and unlike the staff register above, it is about them rather
     * than about the site, which is why it is kept for months and not a year.
     */
    loginHistory: { retentionDays: loginDays },
  };
});
