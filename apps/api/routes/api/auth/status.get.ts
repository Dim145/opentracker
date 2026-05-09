import { count, eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users, webauthnCredentials } from '@trackarr/db/schema';
import { getSetting, SETTINGS_KEYS, isInviteEnabled } from '~~/utils/server';
import { getRequire2FAScope, isUserRequiredFor2FA } from '~~/utils/settings';
import type { PublicUser, ThemePreference } from '@trackarr/shared';

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
        uploaded: users.uploaded,
        downloaded: users.downloaded,
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
        // Cache lookup so /auth/status is one round-trip even when
        // pulling 2FA enforcement state.
        const fullUser = await db.query.users.findFirst({
          where: eq(users.id, session.user.id),
          columns: { totpEnabled: true },
        });
        // Update session if stats, roles, display name or theme changed.
        // These fields drive the navbar / theme so a stale session
        // would otherwise force the user to re-login to see edits.
        const sessionDisplayName =
          (session.user as { displayName?: string | null }).displayName ?? null;
        const sessionTheme =
          (session.user as { theme?: ThemePreference }).theme ?? 'dark';
        if (
          dbUser.uploaded !== session.user.uploaded ||
          dbUser.downloaded !== session.user.downloaded ||
          dbUser.isAdmin !== session.user.isAdmin ||
          dbUser.isModerator !== session.user.isModerator ||
          dbUser.displayName !== sessionDisplayName ||
          dbUser.theme !== sessionTheme
        ) {
          await setUserSession(event, {
            ...session,
            user: {
              ...session.user,
              displayName: dbUser.displayName,
              theme: dbUser.theme as ThemePreference,
              uploaded: dbUser.uploaded,
              downloaded: dbUser.downloaded,
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
          theme: (dbUser.theme as ThemePreference) ?? 'dark',
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
