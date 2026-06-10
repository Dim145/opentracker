import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users } from '@trackarr/db/schema';
import { redis } from '../redis/client';
import { getSessionId } from './session';
import { isFreshAuth } from './twoFactor';

/**
 * Cached `isBanned` lookup — backs `requireAuthSession`.
 *
 * Without a cache, every authenticated request issued a SELECT
 * against `users` just to read a single boolean column. On an
 * active site that meant N queries per page load, all serialised
 * through pgbouncer. We cache the result in Redis for 60 s under
 * `auth:ban:{userId}` and invalidate explicitly when the staff
 * pages flip `is_banned`.
 *
 * Cache values:
 *   - "0"  → user exists and is not banned
 *   - "1"  → user is banned
 *   - "x"  → user no longer exists (treated as banned for safety)
 *
 * The TTL is short on purpose: a moderator who bans a spammer
 * sees the lockout effective within at most 60 s even if the
 * invalidation hook misfires.
 */
const BAN_CACHE_TTL_S = 60;
const banCacheKey = (userId: string) => `auth:ban:${userId}`;

async function readBanStatusCached(
  userId: string
): Promise<'ok' | 'banned' | 'gone'> {
  try {
    const cached = await redis.get(banCacheKey(userId));
    if (cached === '0') return 'ok';
    if (cached === '1') return 'banned';
    if (cached === 'x') return 'gone';
  } catch {
    // Redis hiccup — fall through to a DB hit so we never
    // accidentally lock everyone out on a transient failure.
  }

  const [dbUser] = await db
    .select({ isBanned: users.isBanned })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  let value: 'ok' | 'banned' | 'gone';
  if (!dbUser) value = 'gone';
  else if (dbUser.isBanned) value = 'banned';
  else value = 'ok';

  // Best-effort cache write; if Redis is down, the next request
  // will pay the same DB hit. That's tolerable for a 60 s window.
  try {
    await redis.setex(
      banCacheKey(userId),
      BAN_CACHE_TTL_S,
      value === 'ok' ? '0' : value === 'banned' ? '1' : 'x'
    );
  } catch {
    /* no-op */
  }
  return value;
}

/**
 * Drop the cached ban status for a user. Call from any code path
 * that mutates `users.is_banned` (the admin ban / unban endpoints,
 * the panic flow, etc.) so the next request observes the change
 * without waiting for the TTL.
 */
export async function invalidateBanCache(userId: string): Promise<void> {
  try {
    await redis.del(banCacheKey(userId));
  } catch {
    /* no-op */
  }
}

/**
 * Live staff-role lookup, cached for 60 s — backs the role
 * re-validation in `requireModeratorSession` / `requireAdminSession`.
 *
 * The session cookie is a sealed, stateless 7-day token that bakes
 * in `isAdmin` / `isModerator` at login time. Without this, a user
 * demoted for cause kept a cookie that still asserted staff and
 * could keep hitting admin/mod APIs for up to 7 days (finding M2).
 * Re-reading the authoritative flags here (and bumping the cache on
 * role change) closes that window to ≤ 60 s, mirroring the ban
 * cache. Returns null when the user no longer exists.
 */
const ROLE_CACHE_TTL_S = 60;
const roleCacheKey = (userId: string) => `auth:role:${userId}`;

async function readLiveRoles(
  userId: string
): Promise<{ isAdmin: boolean; isModerator: boolean } | null> {
  try {
    const cached = await redis.get(roleCacheKey(userId));
    if (cached) {
      const p = JSON.parse(cached) as { a: boolean; m: boolean };
      return { isAdmin: !!p.a, isModerator: !!p.m };
    }
  } catch {
    /* fall through to DB */
  }
  const [row] = await db
    .select({ isAdmin: users.isAdmin, isModerator: users.isModerator })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  try {
    await redis.setex(
      roleCacheKey(userId),
      ROLE_CACHE_TTL_S,
      JSON.stringify({ a: row.isAdmin, m: row.isModerator })
    );
  } catch {
    /* no-op */
  }
  return { isAdmin: row.isAdmin, isModerator: row.isModerator };
}

/** Drop the cached role state. Call from any path that changes a
 *  user's `is_admin` / `is_moderator` (role-change endpoint). */
export async function invalidateRoleCache(userId: string): Promise<void> {
  try {
    await redis.del(roleCacheKey(userId));
  } catch {
    /* no-op */
  }
}

/**
 * Re-validate the caller's staff role against the live DB (cached)
 * rather than trusting the sealed cookie, and reconcile the in-memory
 * session so downstream reads see the authoritative value.
 */
async function refreshSessionRoles(
  session: Awaited<ReturnType<typeof requireUserSession>>
): Promise<void> {
  const live = await readLiveRoles(session.user.id);
  if (!live) {
    throw createError({ statusCode: 403, message: 'Account no longer exists' });
  }
  session.user.isAdmin = live.isAdmin;
  session.user.isModerator = live.isModerator;
}

/**
 * Require user authentication and check for bans
 */
export async function requireAuthSession(event: H3Event) {
  const session = await requireUserSession(event);

  // Skip DB check if already verified by middleware (per-request
  // memoisation — distinct from the Redis cache).
  if (event.context.authChecked) {
    return session;
  }

  const status = await readBanStatusCached(session.user.id);
  if (status !== 'ok') {
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

  // Re-validate against the live (cached) role, not the sealed
  // cookie, so a demoted staffer loses access within ≤60 s (M2).
  await refreshSessionRoles(session);

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

  // Re-validate against the live (cached) role, not the sealed
  // cookie (M2).
  await refreshSessionRoles(session);

  if (!session.user?.isAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Admin access required',
    });
  }

  return session;
}

/**
 * Require the caller's session to be inside the fresh-auth window
 * (recent login / 2FA — see twoFactor.FRESH_AUTH_TTL_S, 10 min). Layer
 * this on top of requireAdminSession for the highest-impact, hard-to-undo
 * admin mutations (privilege grants, economy adjustments, panic,
 * federation key provisioning) so a borrowed or exfiltrated — but stale —
 * admin session can't self-escalate without re-authenticating first
 * (finding L10). The FE surfaces the 401 + `reauthRequired` flag as a
 * re-login prompt, mirroring the me/2fa step-up flow.
 */
export async function requireFreshAuth(event: H3Event): Promise<void> {
  const sid = await getSessionId(event);
  if (!(await isFreshAuth(sid))) {
    throw createError({
      statusCode: 401,
      message:
        'Re-authenticate first. This action requires a fresh login (within the last 10 minutes).',
      data: { reauthRequired: true },
    });
  }
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
      // Adult content opt-in flag carried alongside the rest so
      // RSS / Torznab consumers don't need to re-query for it.
      showAdultContent: users.showAdultContent,
    })
    .from(users)
    .where(eq(users.passkey, apikey))
    .limit(1);

  if (!user || user.isBanned) {
    throw createError({ statusCode: 401, message: 'Authentication required' });
  }

  return { user };
}
