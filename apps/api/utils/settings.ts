import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { settings } from '@trackarr/db/schema';
import { redis } from '../redis/client';
import pkg from '../package.json';

// Version is injected by the running app via env when available, but
// the API also ships with its own package.json — fall back to that so
// the subtitle/footer surfaces never read "vdev" in a normal dev run.
const appVersion = process.env.APP_VERSION || pkg.version || 'dev';

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
