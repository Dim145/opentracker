import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users } from '@trackarr/db/schema';

/**
 * Require user authentication and check for bans
 */
export async function requireAuthSession(event: H3Event) {
  const session = await requireUserSession(event);

  // Skip DB check if already verified by middleware
  if (event.context.authChecked) {
    return session;
  }

  // Check DB for ban status to ensure banned users are immediately blocked
  const [dbUser] = await db
    .select({ isBanned: users.isBanned })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!dbUser || dbUser.isBanned) {
    await clearUserSession(event);
    throw createError({
      statusCode: 403,
      message: 'Your account has been banned',
    });
  }

  // Mark as checked
  event.context.authChecked = true;

  return session;
}

/**
 * Require moderator or admin authentication
 */
export async function requireModeratorSession(event: H3Event) {
  const session = await requireAuthSession(event);

  if (!session.user?.isAdmin && !session.user?.isModerator) {
    throw createError({
      statusCode: 403,
      message: 'Moderator access required',
    });
  }

  return session;
}

/**
 * Require admin authentication
 * Uses requireAuthSession and checks isAdmin flag
 */
export async function requireAdminSession(event: H3Event) {
  const session = await requireAuthSession(event);

  if (!session.user?.isAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Admin access required',
    });
  }

  return session;
}

/**
 * Auth gate for endpoints that need to be reachable by both browser
 * sessions (cookie-based) and external clients that authenticate by
 * passkey/apikey (RSS readers, *Arr-style integrations). Tries the
 * session cookie first, then falls back to a `?apikey=` or
 * `?passkey=` query parameter.
 *
 * Returns `{ user }` shaped like a session for callers, regardless of
 * which path matched. On failure, throws 401 — same shape as
 * `requireUserSession` so callers don't need a separate error path.
 *
 * The DB-side `isBanned` check still runs: a banned user can't slip
 * past via passkey just because their session was already cleared.
 */
export async function requireSessionOrApikey(event: H3Event) {
  // 1. Try the regular session path (cheap, also covers banned-user
  // invalidation as a side effect).
  try {
    return await requireAuthSession(event);
  } catch {
    // fall through to apikey
  }

  const query = getQuery(event);
  const apikey =
    (typeof query.apikey === 'string' && query.apikey) ||
    (typeof query.passkey === 'string' && query.passkey) ||
    null;
  if (!apikey) {
    throw createError({ statusCode: 401, message: 'Authentication required' });
  }

  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      passkey: users.passkey,
      isAdmin: users.isAdmin,
      isModerator: users.isModerator,
      isBanned: users.isBanned,
      uploaded: users.uploaded,
      downloaded: users.downloaded,
    })
    .from(users)
    .where(eq(users.passkey, apikey))
    .limit(1);

  if (!user || user.isBanned) {
    throw createError({ statusCode: 401, message: 'Authentication required' });
  }

  return { user };
}
