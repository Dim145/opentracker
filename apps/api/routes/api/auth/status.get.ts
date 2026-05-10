import { count, eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users, webauthnCredentials } from '@trackarr/db/schema';
import { getSetting, SETTINGS_KEYS, isInviteEnabled } from '~~/utils/server';
import { getRequire2FAScope, isUserRequiredFor2FA } from '~~/utils/settings';
import { creditDailyLoginIfDue } from '~~/utils/bonusEarning';
import type {
  LanguagePreference,
  PublicUser,
  ThemePreference,
} from '@trackarr/shared';

/**
 * GET /api/auth/status
 * Returns authentication status and tracker state
 */
export default defineEventHandler(async (event) => {
  // Check if any users exist
  const userCount = await db.select({ count: count() }).from(users);
  const hasUsers = userCount[0].count > 0;

  // Get current user session
  const session = await getUserSession(event);

  // Get registration status
  const registrationOpen = await getSetting(SETTINGS_KEYS.REGISTRATION_OPEN);
  const inviteEnabled = await isInviteEnabled();

  let publicUser: PublicUser | null = null;

  if (session.user) {
    // Fetch latest stats and roles from DB to ensure they are up to date
    const [dbUser] = await db
      .select({
        displayName: users.displayName,
        theme: users.theme,
        language: users.language,
        uploaded: users.uploaded,
        downloaded: users.downloaded,
        bonusPoints: users.bonusPoints,
        isBanned: users.isBanned,
        isAdmin: users.isAdmin,
        isModerator: users.isModerator,
      })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (dbUser) {
      // Check if user is banned
      if (dbUser.isBanned) {
        await clearUserSession(event);
        publicUser = null;
      } else {
        // Daily-login bonus — gated server-side via Redis SETNX so a
        // user hitting /api/auth/status fifty times an hour only
        // collects once per UTC day. The credit lands before we
        // re-read `dbUser.bonusPoints` below so the response carries
        // the post-credit balance.
        try {
          const credited = await creditDailyLoginIfDue(session.user.id);
          if (credited > 0) {
            dbUser.bonusPoints += credited;
          }
        } catch (err) {
          console.warn('[bonus] daily-login credit failed:', err);
        }
        // Cache lookup so /auth/status is one round-trip even when
        // pulling 2FA enforcement state.
        const fullUser = await db.query.users.findFirst({
          where: eq(users.id, session.user.id),
          columns: { totpEnabled: true },
        });
        // Update session if stats, roles, display name, theme or
        // language changed. These fields drive the navbar / theme /
        // i18n bootstrapper, so a stale session would otherwise force
        // the user to re-login to see edits.
        const sessionDisplayName =
          (session.user as { displayName?: string | null }).displayName ?? null;
        const sessionTheme =
          (session.user as { theme?: ThemePreference }).theme ?? 'dark';
        const sessionLanguage =
          (session.user as { language?: LanguagePreference }).language ?? 'en';
        const sessionBonusPoints =
          (session.user as { bonusPoints?: number }).bonusPoints ?? 0;
        if (
          dbUser.uploaded !== session.user.uploaded ||
          dbUser.downloaded !== session.user.downloaded ||
          dbUser.isAdmin !== session.user.isAdmin ||
          dbUser.isModerator !== session.user.isModerator ||
          dbUser.displayName !== sessionDisplayName ||
          dbUser.theme !== sessionTheme ||
          dbUser.language !== sessionLanguage ||
          dbUser.bonusPoints !== sessionBonusPoints
        ) {
          await setUserSession(event, {
            ...session,
            user: {
              ...session.user,
              displayName: dbUser.displayName,
              theme: dbUser.theme as ThemePreference,
              language: dbUser.language as LanguagePreference,
              uploaded: dbUser.uploaded,
              downloaded: dbUser.downloaded,
              bonusPoints: dbUser.bonusPoints,
              isAdmin: dbUser.isAdmin,
              isModerator: dbUser.isModerator,
            },
          });
        }

        publicUser = {
          id: session.user.id,
          username: session.user.username,
          displayName: dbUser.displayName,
          isAdmin: dbUser.isAdmin,
          isModerator: dbUser.isModerator,
          uploaded: dbUser.uploaded,
          downloaded: dbUser.downloaded,
          bonusPoints: dbUser.bonusPoints,
          theme: (dbUser.theme as ThemePreference) ?? 'dark',
          language: (dbUser.language as LanguagePreference) ?? 'en',
        };
        // Decide if the FE should hard-redirect this user to
        // /settings/security. We surface enforcement state here so
        // every page load can act on it without an extra round-trip.
        const required = await isUserRequiredFor2FA({
          isAdmin: dbUser.isAdmin,
          isModerator: dbUser.isModerator,
        });
        const passkeyCount = await db
          .select({ id: webauthnCredentials.id })
          .from(webauthnCredentials)
          .where(eq(webauthnCredentials.userId, session.user.id))
          .then((r) => r.length);
        const has2FA =
          (fullUser?.totpEnabled ?? false) || passkeyCount > 0;
        (publicUser as any).requires2FASetup = required && !has2FA;
      }
    } else {
      // User not found in DB, clear session
      await clearUserSession(event);
      publicUser = null;
    }
  }

  return {
    // If no users exist, show setup page
    needsSetup: !hasUsers,
    // Current user info (null if not logged in) - passkey excluded
    user: publicUser,
    // Whether new registrations are allowed
    registrationOpen: registrationOpen === 'true',
    inviteEnabled,
    // Public scope marker so the FE login form can hint "this site
    // requires 2FA" in advance of the user actually configuring it.
    require2FAScope: await getRequire2FAScope(),
  };
});
