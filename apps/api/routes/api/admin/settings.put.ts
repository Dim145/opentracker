import { requireAdminSession } from '~~/utils/adminAuth';
import {
  setRegistrationOpen,
  setDmRetentionDays,
  setTicketsMode,
  setRoomRetentionDays,
  setRoomSlowModeSeconds,
  setSetting,
  setTemplateQuotaPerUser,
  SETTINGS_KEYS,
} from '~~/utils/server';
import { validateBody, adminSettingsSchema } from '~~/utils/schemas';

/**
 * PUT /api/admin/settings
 * Update tracker settings (admin only)
 */
export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  // Validate request body with Zod
  const body = await validateBody(event, adminSettingsSchema);

  if (body.searchFields !== undefined) {
    // Deduplicated and stored as CSV: the list is short and a JSON array would
    // add nothing but a format to parse on both sides.
    await setSetting(
      SETTINGS_KEYS.SEARCH_FIELDS,
      [...new Set(body.searchFields)].join(',')
    );
  }

  if (typeof body.searchFuzzy === 'boolean') {
    await setSetting(
      SETTINGS_KEYS.SEARCH_FUZZY,
      body.searchFuzzy ? 'true' : 'false'
    );
  }

  if (typeof body.registrationOpen === 'boolean') {
    await setRegistrationOpen(body.registrationOpen);
  }

  if (typeof body.inviteEnabled === 'boolean') {
    await setSetting(
      SETTINGS_KEYS.INVITE_ENABLED,
      body.inviteEnabled ? 'true' : 'false'
    );
  }

  if (typeof body.defaultInvites === 'number') {
    await setSetting(
      SETTINGS_KEYS.DEFAULT_INVITES,
      body.defaultInvites.toString()
    );
  }

  if (typeof body.minRatio === 'number') {
    await setSetting(SETTINGS_KEYS.MIN_RATIO, body.minRatio.toString());
  }

  if (typeof body.starterUpload === 'number') {
    await setSetting(
      SETTINGS_KEYS.STARTER_UPLOAD,
      body.starterUpload.toString()
    );
  }

  if (typeof body.siteName === 'string') {
    await setSetting(SETTINGS_KEYS.SITE_NAME, body.siteName);
  }

  if (typeof body.siteLogo === 'string') {
    await setSetting(SETTINGS_KEYS.SITE_LOGO, body.siteLogo);
  }

  if (body.siteLogoImage !== undefined) {
    if (body.siteLogoImage === null || body.siteLogoImage === '') {
      await setSetting(SETTINGS_KEYS.SITE_LOGO_IMAGE, '');
    } else {
      await setSetting(SETTINGS_KEYS.SITE_LOGO_IMAGE, body.siteLogoImage);
    }
  }

  if (body.siteSubtitle !== undefined) {
    if (body.siteSubtitle === null || body.siteSubtitle === '') {
      await setSetting(SETTINGS_KEYS.SITE_SUBTITLE, '');
    } else {
      await setSetting(SETTINGS_KEYS.SITE_SUBTITLE, body.siteSubtitle);
    }
  }

  if (body.siteNameColor !== undefined) {
    if (body.siteNameColor === null || body.siteNameColor === '') {
      await setSetting(SETTINGS_KEYS.SITE_NAME_COLOR, '');
    } else {
      await setSetting(SETTINGS_KEYS.SITE_NAME_COLOR, body.siteNameColor);
    }
  }

  if (typeof body.siteNameBold === 'boolean') {
    await setSetting(
      SETTINGS_KEYS.SITE_NAME_BOLD,
      body.siteNameBold ? 'true' : 'false'
    );
  }

  // Extended branding
  if (body.authTitle !== undefined) {
    await setSetting(SETTINGS_KEYS.AUTH_TITLE, body.authTitle || '');
  }

  if (body.authSubtitle !== undefined) {
    await setSetting(SETTINGS_KEYS.AUTH_SUBTITLE, body.authSubtitle || '');
  }

  if (body.footerText !== undefined) {
    await setSetting(SETTINGS_KEYS.FOOTER_TEXT, body.footerText || '');
  }

  if (body.pageTitleSuffix !== undefined) {
    await setSetting(
      SETTINGS_KEYS.PAGE_TITLE_SUFFIX,
      body.pageTitleSuffix || ''
    );
  }

  if (body.welcomeMessage !== undefined) {
    await setSetting(SETTINGS_KEYS.WELCOME_MESSAGE, body.welcomeMessage || '');
  }

  if (body.siteRules !== undefined) {
    await setSetting(SETTINGS_KEYS.SITE_RULES, body.siteRules || '');
  }

  if (typeof body.announcementEnabled === 'boolean') {
    await setSetting(
      SETTINGS_KEYS.ANNOUNCEMENT_ENABLED,
      body.announcementEnabled ? 'true' : 'false'
    );
  }

  if (typeof body.announcementMessage === 'string') {
    await setSetting(
      SETTINGS_KEYS.ANNOUNCEMENT_MESSAGE,
      body.announcementMessage
    );
  }

  if (typeof body.announcementType === 'string') {
    await setSetting(SETTINGS_KEYS.ANNOUNCEMENT_TYPE, body.announcementType);
  }

  // Homepage content
  if (typeof body.heroTitle === 'string') {
    await setSetting(SETTINGS_KEYS.HERO_TITLE, body.heroTitle);
  }

  if (typeof body.heroSubtitle === 'string') {
    await setSetting(SETTINGS_KEYS.HERO_SUBTITLE, body.heroSubtitle);
  }

  if (typeof body.statusBadgeText === 'string') {
    await setSetting(SETTINGS_KEYS.STATUS_BADGE_TEXT, body.statusBadgeText);
  }

  if (typeof body.feature1Title === 'string') {
    await setSetting(SETTINGS_KEYS.FEATURE_1_TITLE, body.feature1Title);
  }

  if (typeof body.feature1Desc === 'string') {
    await setSetting(SETTINGS_KEYS.FEATURE_1_DESC, body.feature1Desc);
  }

  if (typeof body.feature2Title === 'string') {
    await setSetting(SETTINGS_KEYS.FEATURE_2_TITLE, body.feature2Title);
  }

  if (typeof body.feature2Desc === 'string') {
    await setSetting(SETTINGS_KEYS.FEATURE_2_DESC, body.feature2Desc);
  }

  if (typeof body.feature3Title === 'string') {
    await setSetting(SETTINGS_KEYS.FEATURE_3_TITLE, body.feature3Title);
  }

  if (typeof body.feature3Desc === 'string') {
    await setSetting(SETTINGS_KEYS.FEATURE_3_DESC, body.feature3Desc);
  }

  // 2FA enforcement scope. Only the three sentinel values are
  // accepted; the FE renders them as a 3-way segmented control.
  if (
    body.require2FAScope === 'off' ||
    body.require2FAScope === 'staff' ||
    body.require2FAScope === 'all'
  ) {
    await setSetting(SETTINGS_KEYS.REQUIRE_2FA_SCOPE, body.require2FAScope);
  }

  // Messaging scopes. Same three sentinel values as the 2FA scope, and
  // the same 3-way segmented control on the front end. The two surfaces
  // are independent: opening private messages without the room is the
  // careful rollout, and the reverse is defensible too.
  for (const [field, key] of [
    ['messagingDmScope', SETTINGS_KEYS.MESSAGING_DM_SCOPE],
    ['messagingRoomScope', SETTINGS_KEYS.MESSAGING_ROOM_SCOPE],
  ] as const) {
    const value = (body as Record<string, unknown>)[field];
    if (value === 'off' || value === 'staff' || value === 'all') {
      await setSetting(key, value);
    }
  }

  // Room retention, in days. Clamped rather than rejected, and the floor
  // is not cosmetic: at zero the room becomes a channel with no trace,
  // where a report can no longer show the staff anything.
  if (typeof body.messagingRoomRetentionDays === 'number') {
    await setRoomRetentionDays(body.messagingRoomRetentionDays);
  }
  if (typeof body.messagingRoomSlowModeSeconds === 'number') {
    await setRoomSlowModeSeconds(body.messagingRoomSlowModeSeconds);
  }
  // Private-message retention. Zero is off and is the default — these
  // rows belong to the members rather than to the instance, so nothing
  // deletes them until an operator says so. Above zero the floor is a
  // week: a report is filed after the fact, and a window shorter than the
  // delay between "this happened" and "somebody said so" leaves the staff
  // nothing to look at. Published to members on `/privacy`.
  if (typeof body.messagingDmRetentionDays === 'number') {
    await setDmRetentionDays(body.messagingDmRetentionDays);
  }
  // off | suspended | on. `suspended` is the one worth having: it keeps
  // every open ticket workable and refuses new ones, which is the honest
  // answer to a staff that is underwater. Switching the desk off answers
  // the same question by abandoning whoever is mid-conversation.
  if (typeof body.ticketsMode === 'string') {
    await setTicketsMode(body.ticketsMode);
  }

  // Notification retention TTLs. Clamped 1–3650 days; out-of-range
  // input is dropped silently rather than 400ing so a sloppy
  // payload from a multi-section save doesn't reject the whole
  // request.
  if (
    typeof body.notificationsRetentionReadDays === 'number' &&
    body.notificationsRetentionReadDays >= 1 &&
    body.notificationsRetentionReadDays <= 3650
  ) {
    await setSetting(
      SETTINGS_KEYS.NOTIFICATIONS_RETENTION_READ_DAYS,
      String(Math.floor(body.notificationsRetentionReadDays)),
    );
  }
  if (
    typeof body.notificationsRetentionUnreadDays === 'number' &&
    body.notificationsRetentionUnreadDays >= 1 &&
    body.notificationsRetentionUnreadDays <= 3650
  ) {
    await setSetting(
      SETTINGS_KEYS.NOTIFICATIONS_RETENTION_UNREAD_DAYS,
      String(Math.floor(body.notificationsRetentionUnreadDays)),
    );
  }

  // Upload-request bounty board tunables — clamped here as
  // defence-in-depth alongside the schema bounds.
  if (
    typeof body.requestAutoValidateHours === 'number' &&
    body.requestAutoValidateHours >= 1 &&
    body.requestAutoValidateHours <= 8760
  ) {
    await setSetting(
      SETTINGS_KEYS.REQUEST_AUTO_VALIDATE_HOURS,
      String(Math.floor(body.requestAutoValidateHours)),
    );
  }
  if (
    typeof body.requestMaxFillsPerUser === 'number' &&
    body.requestMaxFillsPerUser >= 1 &&
    body.requestMaxFillsPerUser <= 20
  ) {
    await setSetting(
      SETTINGS_KEYS.REQUEST_MAX_FILLS_PER_USER,
      String(Math.floor(body.requestMaxFillsPerUser)),
    );
  }

  // Presentation-template quota. Written through the shared clamp rather
  // than an inline bounds check so the stored string can never be a value
  // the reader would reject and silently replace with the default.
  if (typeof body.templateQuotaPerUser === 'number') {
    await setTemplateQuotaPerUser(body.templateQuotaPerUser);
  }

  return {
    success: true,
    ...body,
  };
});
