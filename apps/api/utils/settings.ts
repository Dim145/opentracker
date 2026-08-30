import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { settings } from '@trackarr/db/schema';
import { redis } from '../redis/client';
import { clampTemplateQuota } from './templatePolicy';
import pkg from '../package.json';

// Version is injected by the running app via env when available, but
// the API also ships with its own package.json — fall back to that so
// the subtitle/footer surfaces never read "vdev" in a normal dev run.
export const appVersion = process.env.APP_VERSION || pkg.version || 'dev';

// ============================================================================
// Cross-instance cache invalidation via Redis pub/sub
// ============================================================================
//
// When `setSetting` updates a value on instance A, instance B's in-memory cache
// would otherwise serve a stale value for up to CACHE_TTL. We publish to a
// dedicated channel and a subscriber on each instance evicts the matching key.
const SETTINGS_INVALIDATE_CHANNEL = 'settings:invalidate';

let subscriberStarted = false;
function ensureSubscriber(): void {
  if (subscriberStarted) return;
  subscriberStarted = true;
  // Tracked outside the try so the catch can release a partially-built
  // socket. Without this, a synchronous failure after `redis.duplicate()`
  // returned would leave an orphaned connection on every retry.
  let sub: ReturnType<typeof redis.duplicate> | null = null;
  try {
    // The shared client uses lazyConnect + enableOfflineQueue=false (DDoS
    // protection on hot request paths) — but those defaults are wrong for a
    // long-lived idle subscriber, which needs to queue SUBSCRIBE until the TCP
    // socket becomes writeable. Override both for the duplicate.
    sub = redis.duplicate({
      lazyConnect: false,
      enableOfflineQueue: true,
    });
    sub.on('message', (channel, message) => {
      if (channel !== SETTINGS_INVALIDATE_CHANNEL) return;
      if (message === '*') {
        settingsCache.clear();
      } else {
        settingsCache.delete(message);
      }
    });
    sub.on('error', (err) => {
      // Non-fatal: invalidation falls back to TTL. ioredis reconnects on its
      // own, so we don't spam logs on transient socket churn.
      const code = (err as any)?.code;
      if (code !== 'ECONNRESET' && code !== 'EPIPE') {
        console.warn('[Settings] subscriber error:', err.message);
      }
    });
    // Subscribe once. ioredis re-issues SUBSCRIBE on reconnect automatically,
    // so we deliberately keep `subscriberStarted = true` even on a transient
    // failure here — re-attempting on every getSetting() would flood the
    // logs with hundreds of identical lines per request burst.
    sub.subscribe(SETTINGS_INVALIDATE_CHANNEL).catch((err) => {
      console.warn(
        '[Settings] initial subscribe failed (will retry on reconnect):',
        err.message
      );
    });
  } catch (err: any) {
    console.warn('[Settings] failed to set up subscriber:', err.message);
    if (sub) {
      try {
        sub.disconnect();
      } catch {
        // best-effort cleanup
      }
    }
    subscriberStarted = false; // synchronous setup failure: allow one retry
  }
}

// Treat <p></p>, <br>, and stray whitespace as "unset" so a user who
// clears a rich-text field doesn't end up with the literal placeholder
// markup as the rendered value. We loop until the string stops shrinking
// because a single pass can't strip pathological inputs like
// `<<script>script>` (after one pass: `<script>` — visible markup).
function isEmptyHtml(html: string | null): boolean {
  if (!html) return true;
  let s = html;
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, '');
  } while (s !== prev);
  return s.trim().length === 0;
}

export const SETTINGS_KEYS = {
  REGISTRATION_OPEN: 'registration_open',
  MIN_RATIO: 'min_ratio',
  STARTER_UPLOAD: 'starter_upload',
  HNR_ENABLED: 'hnr_enabled',
  HNR_REQUIRED_SEED_TIME: 'hnr_required_seed_time',
  HNR_GRACE_PERIOD: 'hnr_grace_period',
  // 2FA enforcement (off | staff | all). 'staff' forces admins +
  // moderators, 'all' forces every user. 'off' is the default and
  // makes 2FA an opt-in personal setting.
  REQUIRE_2FA_SCOPE: 'require_2fa_scope',
  // Messaging (off | staff | all), one scope per surface so private
  // messages can open without the room, or the other way round. Both
  // default to 'off': an instance that updates must not find itself with
  // a harassment surface open it never decided on.
  MESSAGING_DM_SCOPE: 'messaging_dm_scope',
  MESSAGING_ROOM_SCOPE: 'messaging_room_scope',
  MESSAGING_ROOM_RETENTION_DAYS: 'messaging_room_retention_days',
  MESSAGING_DM_RETENTION_DAYS: 'messaging_dm_retention_days',
  MESSAGING_ROOM_SLOW_MODE_S: 'messaging_room_slow_mode_s',
  INVITE_ENABLED: 'invite_enabled',
  DEFAULT_INVITES: 'default_invites',
  SITE_NAME: 'site_name',
  SITE_LOGO: 'site_logo',
  SITE_LOGO_IMAGE: 'site_logo_image',
  SITE_FAVICON: 'site_favicon',
  SITE_SUBTITLE: 'site_subtitle',
  SITE_NAME_COLOR: 'site_name_color',
  SITE_NAME_BOLD: 'site_name_bold',
  // Extended branding
  AUTH_TITLE: 'auth_title',
  AUTH_SUBTITLE: 'auth_subtitle',
  FOOTER_TEXT: 'footer_text',
  PAGE_TITLE_SUFFIX: 'page_title_suffix',
  WELCOME_MESSAGE: 'welcome_message',
  SITE_RULES: 'site_rules',
  ANNOUNCEMENT_ENABLED: 'announcement_enabled',
  ANNOUNCEMENT_MESSAGE: 'announcement_message',
  ANNOUNCEMENT_TYPE: 'announcement_type',
  // Homepage content
  HERO_TITLE: 'hero_title',
  HERO_SUBTITLE: 'hero_subtitle',
  STATUS_BADGE_TEXT: 'status_badge_text',
  FEATURE_1_TITLE: 'feature_1_title',
  FEATURE_1_DESC: 'feature_1_desc',
  FEATURE_2_TITLE: 'feature_2_title',
  FEATURE_2_DESC: 'feature_2_desc',
  FEATURE_3_TITLE: 'feature_3_title',
  FEATURE_3_DESC: 'feature_3_desc',
  // ── Notification retention (days) ───────────────────────────
  // Two separate TTLs because read and unread rows carry different
  // weight: a read row is just an archive entry; an unread row is
  // information the user hasn't acknowledged yet. Defaults match
  // (90 / 90) but operators typically bump unread → 180+ once
  // they've observed real usage.
  NOTIFICATIONS_RETENTION_READ_DAYS: 'notifications_retention_read_days',
  NOTIFICATIONS_RETENTION_UNREAD_DAYS: 'notifications_retention_unread_days',
  // Days to keep a superseded federation record generation before pruning it.
  // 0 (default) keeps them forever — the safe default, since a consumer walking
  // a lineage needs the chain. The prune only ever removes a superseded record
  // nothing live still supersedes.
  FEDERATION_RECORD_RETENTION_DAYS: 'federation_record_retention_days',
  // Whether we honour a partner's signed contribution attestations by crediting
  // the named member's bonus upload. Off by default — trusting a partner's word
  // about what its users pulled is the operator's call. (Credit model / M4.)
  FEDERATION_CREDIT_ENABLED: 'federation_credit_enabled',
  // Ceiling on bonus bytes one member can be credited from partner attestations
  // per rolling day, so a compromised or over-generous partner cannot mint
  // unbounded ratio. Bytes; default set in the reader.
  FEDERATION_CREDIT_DAILY_CAP_BYTES: 'federation_credit_daily_cap_bytes',
  // Ceiling on bonus bytes ONE PARTNER can mint per rolling day, across all of
  // our members. The per-member cap above bounds inflation for a member; it
  // does not bound a partner, whose reach is that cap times the number of our
  // members it can name. This is the lever for trusting partner A more than
  // partner B. 0 (default) means no per-peer ceiling.
  FEDERATION_CREDIT_PEER_DAILY_CAP_BYTES: 'federation_credit_peer_daily_cap_bytes',
  // Ceiling on bonus bytes credited from ALL partners per rolling day. The
  // total-inflation lever: whatever the mesh claims, the economy absorbs at
  // most this per day. 0 (default) means no instance-wide ceiling.
  FEDERATION_CREDIT_INSTANCE_DAILY_CAP_BYTES:
    'federation_credit_instance_daily_cap_bytes',
  // ── Upload requests (bounty board) ─────────────────────────
  // Hours a request can sit in `filled` state before the cron
  // auto-validates and pays the filler. 168 h (7 days) is the
  // default — short enough that fillers don't sit on locked
  // points forever, long enough that holidays / sick days don't
  // surprise-trigger the auto-validate.
  REQUEST_AUTO_VALIDATE_HOURS: 'request_auto_validate_hours',
  // Maximum number of fill attempts (proposed + rejected) a
  // single user can stack against the same request. Caps abuse
  // ("I'll just keep throwing torrents until something sticks")
  // without forcing perfect first tries.
  REQUEST_MAX_FILLS_PER_USER: 'request_max_fills_per_user',
  // ── Themes ─────────────────────────────────────────────────
  // Which theme an anonymous visitor and a brand-new member get. Defaults to
  // `dark`, which is what an instance looked like before this setting existed — so an upgrade
  // changes nothing until an operator decides otherwise. Set it to `system` to
  // follow each visitor's operating system.
  THEME_DEFAULT: 'theme_default',
  // The two halves of `system` mode. Both default to the built-ins, and the
  // route refuses to set them to the same theme — a "system" mode that resolves
  // to one appearance is not a system mode.
  THEME_SYSTEM_LIGHT: 'theme_system_light',
  THEME_SYSTEM_DARK: 'theme_system_dark',
  // Monotonic counter, bumped on every theme write. It is the ETag for
  // `/api/theme.css`: `max(updated_at)` would miss a DELETE, and hashing the
  // emitted CSS would mean building it to find out whether to build it.
  THEME_VERSION: 'theme_version',
  // ── Presentation templates ─────────────────────────────────
  // How many templates one user may own. Templates are cheap rows
  // but they are also a stored-text surface, so the cap exists to
  // bound abuse rather than to ration a scarce resource — hence a
  // low default (5) an operator can lift freely.
  TEMPLATE_QUOTA_PER_USER: 'template_quota_per_user',
  // Fields scanned by free-text search, as CSV: name,description,nfo,tags.
  SEARCH_FIELDS: 'search_fields',
  // Typo fallback. Expensive (word_similarity re-reads many candidate rows):
  // left switchable for large catalogues.
  SEARCH_FUZZY: 'search_fuzzy',
} as const;

const settingsCache = new Map<
  string,
  { value: string | null; timestamp: number }
>();
const CACHE_TTL = 60000; // 1 minute cache for settings

export async function getSetting(key: string): Promise<string | null> {
  ensureSubscriber();
  const cached = settingsCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.value;
  }

  const result = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);

  const value = result.length > 0 ? result[0].value : null;
  settingsCache.set(key, { value, timestamp: Date.now() });
  return value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  ensureSubscriber();
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });

  // Invalidate cache locally and on every other instance.
  settingsCache.delete(key);
  try {
    await redis.publish(SETTINGS_INVALIDATE_CHANNEL, key);
  } catch (err: any) {
    // Non-fatal: TTL still bounds staleness on other instances.
    console.warn('[Settings] invalidate publish error:', err.message);
  }
}

export async function isRegistrationOpen(): Promise<boolean> {
  // Default closed if unset — opt-in registration is the safer default
  // for a brand-new install before the operator has tightened anything.
  const value = await getSetting(SETTINGS_KEYS.REGISTRATION_OPEN);
  return value === 'true';
}

export async function setRegistrationOpen(open: boolean): Promise<void> {
  await setSetting(SETTINGS_KEYS.REGISTRATION_OPEN, open ? 'true' : 'false');
}

export async function getMinRatio(): Promise<number> {
  const value = await getSetting(SETTINGS_KEYS.MIN_RATIO);
  return value ? parseFloat(value) : 0;
}

export async function getStarterUpload(): Promise<number> {
  const value = await getSetting(SETTINGS_KEYS.STARTER_UPLOAD);
  return value ? parseInt(value, 10) : 0;
}

export async function isHnrEnabled(): Promise<boolean> {
  const value = await getSetting(SETTINGS_KEYS.HNR_ENABLED);
  return value === 'true';
}

export async function getHnrRequiredSeedTime(): Promise<number> {
  // 24h default mirrors the tracker's `hnrRequiredSeedTime` fallback so
  // both sides agree if the row is missing.
  const value = await getSetting(SETTINGS_KEYS.HNR_REQUIRED_SEED_TIME);
  return value ? parseInt(value, 10) : 86400;
}

export async function getHnrGracePeriod(): Promise<number> {
  const value = await getSetting(SETTINGS_KEYS.HNR_GRACE_PERIOD);
  return value ? parseInt(value, 10) : 259200;
}

/**
 * 2FA enforcement scope. `off` lets 2FA be a per-user opt-in (the
 * default), `staff` forces admins + moderators to configure it,
 * `all` forces every user. Sourced from settings, cached.
 */
export type Require2FAScope = 'off' | 'staff' | 'all';

export async function getRequire2FAScope(): Promise<Require2FAScope> {
  const value = await getSetting(SETTINGS_KEYS.REQUIRE_2FA_SCOPE);
  if (value === 'staff' || value === 'all') return value;
  return 'off';
}

export async function setRequire2FAScope(scope: Require2FAScope): Promise<void> {
  await setSetting(SETTINGS_KEYS.REQUIRE_2FA_SCOPE, scope);
}

/**
 * Decide whether `user` must have 2FA configured to proceed past the
 * settings page. Used by the auth middleware on the FE / a guard
 * server-side.
 */
export async function isUserRequiredFor2FA(opts: {
  isAdmin: boolean;
  isModerator: boolean;
}): Promise<boolean> {
  const scope = await getRequire2FAScope();
  if (scope === 'off') return false;
  if (scope === 'all') return true;
  // 'staff' — force admins + mods only.
  return opts.isAdmin || opts.isModerator;
}

export async function isInviteEnabled(): Promise<boolean> {
  const value = await getSetting(SETTINGS_KEYS.INVITE_ENABLED);
  return value === 'true';
}

export async function getDefaultInvites(): Promise<number> {
  const value = await getSetting(SETTINGS_KEYS.DEFAULT_INVITES);
  return value ? parseInt(value, 10) : 2;
}

export async function getSiteName(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.SITE_NAME);
  return isEmptyHtml(value) ? 'TRACKARR' : value!;
}

export async function getSiteLogo(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.SITE_LOGO);
  return value || 'ph:broadcast-bold';
}

export async function getSiteLogoImage(): Promise<string | null> {
  const value = await getSetting(SETTINGS_KEYS.SITE_LOGO_IMAGE);
  return value || null;
}

export async function getSiteFavicon(): Promise<string | null> {
  const value = await getSetting(SETTINGS_KEYS.SITE_FAVICON);
  return value || null;
}

export async function getSiteSubtitle(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.SITE_SUBTITLE);
  return isEmptyHtml(value) ? `v${appVersion}` : value!;
}

export async function getSiteNameColor(): Promise<string | null> {
  const value = await getSetting(SETTINGS_KEYS.SITE_NAME_COLOR);
  return value || null;
}

export async function isSiteNameBold(): Promise<boolean> {
  // Default true — the original brand mark uses a bold weight, so an
  // unset value should match what existing installs render today.
  const value = await getSetting(SETTINGS_KEYS.SITE_NAME_BOLD);
  return value !== 'false';
}

export async function getAuthTitle(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.AUTH_TITLE);
  return isEmptyHtml(value) ? '' : value!;
}

export async function getAuthSubtitle(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.AUTH_SUBTITLE);
  return isEmptyHtml(value) ? 'Private BitTorrent Tracker' : value!;
}

export async function getFooterText(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.FOOTER_TEXT);
  return isEmptyHtml(value) ? '' : value!;
}

export async function getPageTitleSuffix(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.PAGE_TITLE_SUFFIX);
  return value || '';
}

export async function getWelcomeMessage(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.WELCOME_MESSAGE);
  return value || '';
}

export async function getSiteRules(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.SITE_RULES);
  return value || '';
}

export async function isAnnouncementEnabled(): Promise<boolean> {
  const value = await getSetting(SETTINGS_KEYS.ANNOUNCEMENT_ENABLED);
  return value === 'true';
}

export async function getAnnouncementMessage(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.ANNOUNCEMENT_MESSAGE);
  return value || '';
}

export async function getAnnouncementType(): Promise<
  'info' | 'warning' | 'error'
> {
  // Coerce any unrecognised value to 'info' so a typo in the DB row
  // doesn't render a banner with broken styling.
  const value = await getSetting(SETTINGS_KEYS.ANNOUNCEMENT_TYPE);
  if (value === 'warning' || value === 'error') return value;
  return 'info';
}

// ============================================================================
// Homepage Content
// ============================================================================

export async function getHeroTitle(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.HERO_TITLE);
  return value || 'Trackarr';
}

export async function getHeroSubtitle(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.HERO_SUBTITLE);
  return (
    value ||
    'High-performance, minimalist P2P tracking engine. Search through our indexed database of verified torrents.'
  );
}

export async function getStatusBadgeText(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.STATUS_BADGE_TEXT);
  return value || 'Tracker Online & Operational';
}

export async function getFeature1Title(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.FEATURE_1_TITLE);
  return value || 'High Performance';
}

export async function getFeature1Desc(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.FEATURE_1_DESC);
  return (
    value ||
    'Built with Node.js and Redis for sub-millisecond response times and high concurrency support.'
  );
}

export async function getFeature2Title(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.FEATURE_2_TITLE);
  return value || 'Multi-Protocol';
}

export async function getFeature2Desc(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.FEATURE_2_DESC);
  return (
    value ||
    'Supports HTTP, UDP, and WebSocket protocols for maximum compatibility with all BitTorrent clients.'
  );
}

export async function getFeature3Title(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.FEATURE_3_TITLE);
  return value || 'Open Source';
}

export async function getFeature3Desc(): Promise<string> {
  const value = await getSetting(SETTINGS_KEYS.FEATURE_3_DESC);
  return (
    value ||
    'Fully transparent and community-driven. Designed for privacy and efficiency in the P2P ecosystem.'
  );
}


// ── Notification retention helpers ──────────────────────────────
//
// Both default to 90 days. The retention sweep (cron) reads these
// each tick so an operator who bumps the value mid-run gets the
// new TTL applied on the next pass without a restart.
//
// Bounds: 1–3650 days at the validator; we clamp parses too so a
// hand-edited Redis cache (rare but possible) can't paralyze the
// sweep with a bogus negative.

export async function getNotificationsRetentionReadDays(): Promise<number> {
  const value = await getSetting(
    SETTINGS_KEYS.NOTIFICATIONS_RETENTION_READ_DAYS,
  );
  const parsed = value ? parseInt(value, 10) : 90;
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 3650) return 90;
  return parsed;
}

export async function setNotificationsRetentionReadDays(
  days: number,
): Promise<void> {
  await setSetting(
    SETTINGS_KEYS.NOTIFICATIONS_RETENTION_READ_DAYS,
    String(days),
  );
}

export async function getNotificationsRetentionUnreadDays(): Promise<number> {
  const value = await getSetting(
    SETTINGS_KEYS.NOTIFICATIONS_RETENTION_UNREAD_DAYS,
  );
  const parsed = value ? parseInt(value, 10) : 90;
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 3650) return 90;
  return parsed;
}

export async function setNotificationsRetentionUnreadDays(
  days: number,
): Promise<void> {
  await setSetting(
    SETTINGS_KEYS.NOTIFICATIONS_RETENTION_UNREAD_DAYS,
    String(days),
  );
}

// ── Upload-request bounty board ─────────────────────────────────
// Bounds: 1–8760 h (1 year) on the timeout, 1–20 on the per-user
// fill cap. Clamp parses too so a hand-edited Redis cache can't
// freeze the cron or open a re-propose loop.

export async function getRequestAutoValidateHours(): Promise<number> {
  const value = await getSetting(SETTINGS_KEYS.REQUEST_AUTO_VALIDATE_HOURS);
  const parsed = value ? parseInt(value, 10) : 168;
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 8760) return 168;
  return parsed;
}

export async function setRequestAutoValidateHours(hours: number): Promise<void> {
  await setSetting(
    SETTINGS_KEYS.REQUEST_AUTO_VALIDATE_HOURS,
    String(hours),
  );
}

export async function getRequestMaxFillsPerUser(): Promise<number> {
  const value = await getSetting(SETTINGS_KEYS.REQUEST_MAX_FILLS_PER_USER);
  const parsed = value ? parseInt(value, 10) : 3;
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 20) return 3;
  return parsed;
}

export async function setRequestMaxFillsPerUser(value: number): Promise<void> {
  await setSetting(
    SETTINGS_KEYS.REQUEST_MAX_FILLS_PER_USER,
    String(value),
  );
}

// ── Presentation templates ──────────────────────────────────────
// The clamp lives in utils/templatePolicy so the number the create
// endpoint enforces and the number the unit tests pin are the same
// function, not two copies of the same bounds.

export async function getTemplateQuotaPerUser(): Promise<number> {
  return clampTemplateQuota(
    await getSetting(SETTINGS_KEYS.TEMPLATE_QUOTA_PER_USER),
  );
}

export async function setTemplateQuotaPerUser(value: number): Promise<void> {
  await setSetting(
    SETTINGS_KEYS.TEMPLATE_QUOTA_PER_USER,
    String(clampTemplateQuota(value)),
  );
}

// ─────────────────────────────────────────────────────────────────────
// Messaging
// ─────────────────────────────────────────────────────────────────────

/**
 * Who may use a messaging surface. Same three states as the 2FA scope,
 * and for the same reason: a boolean cannot express "staff only", which
 * is what you want while rolling the feature out and what you fall back
 * to if the room turns sour.
 */
export type MessagingScope = 'off' | 'staff' | 'all';

function readScope(value: string | null): MessagingScope {
  if (value === 'staff' || value === 'all') return value;
  return 'off';
}

export async function getMessagingDmScope(): Promise<MessagingScope> {
  return readScope(await getSetting(SETTINGS_KEYS.MESSAGING_DM_SCOPE));
}

export async function setMessagingDmScope(scope: MessagingScope) {
  await setSetting(SETTINGS_KEYS.MESSAGING_DM_SCOPE, scope);
}

export async function getMessagingRoomScope(): Promise<MessagingScope> {
  return readScope(await getSetting(SETTINGS_KEYS.MESSAGING_ROOM_SCOPE));
}

export async function setMessagingRoomScope(scope: MessagingScope) {
  await setSetting(SETTINGS_KEYS.MESSAGING_ROOM_SCOPE, scope);
}

/**
 * Whether this viewer may use the surface at all.
 *
 * Callers turn a `false` into a **404**, not a 403: a 403 confirms the
 * feature exists, which is exactly what an instance running with it off
 * would rather not say.
 */
export function scopeAdmits(
  scope: MessagingScope,
  user: { isAdmin?: boolean; isModerator?: boolean }
): boolean {
  if (scope === 'off') return false;
  if (scope === 'all') return true;
  return !!user.isAdmin || !!user.isModerator;
}

/**
 * How long the room keeps its messages, in days.
 *
 * Fourteen holds both ends: at 3 messages a second it is 3.6M rows rather
 * than the 7.8M thirty days would carry, while still covering the usual
 * delay between a message going wrong and somebody reporting it.
 *
 * The floor is not a formality. At zero the room becomes a channel with no
 * trace, where a report can no longer show anything to the staff — so the
 * setting cannot go below a day, whatever an administrator types.
 */
export const ROOM_RETENTION_MIN_DAYS = 1;
/**
 * And a ceiling, which lived only in the admin component's input — a
 * direct PUT could set ten thousand days and the sweep would then keep
 * every partition ever created.
 */
export const ROOM_RETENTION_MAX_DAYS = 365;
export const ROOM_RETENTION_DEFAULT_DAYS = 14;

export async function getRoomRetentionDays(): Promise<number> {
  const value = await getSetting(SETTINGS_KEYS.MESSAGING_ROOM_RETENTION_DAYS);
  const parsed = value ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) return ROOM_RETENTION_DEFAULT_DAYS;
  return Math.max(ROOM_RETENTION_MIN_DAYS, parsed);
}

export async function setRoomRetentionDays(days: number) {
  const clamped = Math.min(
    ROOM_RETENTION_MAX_DAYS,
    Math.max(ROOM_RETENTION_MIN_DAYS, Math.floor(days))
  );
  await setSetting(
    SETTINGS_KEYS.MESSAGING_ROOM_RETENTION_DAYS,
    String(clamped)
  );
}

/**
 * How long a private message is kept, in days. Zero is off.
 *
 * **Off by default, and it stays off on upgrade.** Every other retention
 * in this codebase ships with a window because the data is the
 * instance's; this data is the members'. Turning it on for them at deploy
 * time would delete correspondence they have no idea is on a timer, so
 * the operator decides and the members are told — the setting is
 * published on `/privacy`, which reads it live rather than repeating a
 * number that would drift.
 *
 * The floor above zero is seven days, for the same reason the room's is
 * one: a report is filed after the fact, and a window shorter than the
 * gap between "this happened" and "somebody said so" leaves the staff
 * with nothing to look at.
 */
export const DM_RETENTION_MIN_DAYS = 7;
export const DM_RETENTION_MAX_DAYS = 3650;

export async function getDmRetentionDays(): Promise<number> {
  const value = await getSetting(SETTINGS_KEYS.MESSAGING_DM_RETENTION_DAYS);
  const parsed = value ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(DM_RETENTION_MAX_DAYS, Math.max(DM_RETENTION_MIN_DAYS, parsed));
}

export async function setDmRetentionDays(days: number) {
  const floored = Math.floor(days);
  const clamped =
    floored <= 0
      ? 0
      : Math.min(DM_RETENTION_MAX_DAYS, Math.max(DM_RETENTION_MIN_DAYS, floored));
  await setSetting(
    SETTINGS_KEYS.MESSAGING_DM_RETENTION_DAYS,
    String(clamped)
  );
}

/** Seconds a member must wait between two room messages. 0 disables it. */
export async function getRoomSlowModeSeconds(): Promise<number> {
  const value = await getSetting(SETTINGS_KEYS.MESSAGING_ROOM_SLOW_MODE_S);
  const parsed = value ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export async function setRoomSlowModeSeconds(seconds: number) {
  await setSetting(
    SETTINGS_KEYS.MESSAGING_ROOM_SLOW_MODE_S,
    String(Math.max(0, Math.floor(seconds)))
  );
}
