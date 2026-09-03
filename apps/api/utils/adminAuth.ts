import type { H3Event } from 'h3';
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { bannedIps, users } from '@trackarr/db/schema';
import { redis } from '../redis/client';
import { getSessionId } from './session';
// Le cache de rôles vit dans son propre module depuis que `session.ts` en a
// besoin : voir l'en-tête de `liveRoles.ts`.
//
// PAS de ré-export ici. Il y en avait un, pour ne pas toucher aux appelants —
// mais Nitro auto-importe `apps/api/utils/`, voyait donc `readLiveRoles` et
// `invalidateRoleCache` déclarés deux fois, et en ignorait un au hasard
// documenté (« Duplicated imports … has been ignored »). C'est exactement la
// collision qui a fait servir la mauvaise `formatSize` pendant des mois côté
// web. Les deux appelants explicites importent depuis `liveRoles` directement.
import { readLiveRoles } from './liveRoles';
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

export async function readBanStatusCached(
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
    .select({ isBanned: users.isBanned, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  let value: 'ok' | 'banned' | 'gone';
  // An erased account keeps its row (the catalogue hangs off it) but must be
  // refused like a missing one: `gone`, so the session is cleared and no
  // personal surface is reachable behind a stale cookie.
  if (!dbUser || dbUser.deletedAt) value = 'gone';
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
 * Cached IP-ban lookup — backs the security middleware.
 *
 * The middleware used to run an uncached `SELECT` on `banned_ips` for EVERY
 * request, ahead of any rate limiting: an unauthenticated flood therefore
 * cost one Postgres round trip per packet, through pgbouncer, before a single
 * defence could fire. That is an amplification, not a defence.
 *
 * Same shape as the user ban cache: a short TTL so a fresh ban takes effect
 * within a minute even if the explicit invalidation misfires, plus negative
 * caching so the common "not banned" answer costs one Redis GET.
 */
const IP_BAN_CACHE_TTL_S = 60;
const ipBanCacheKey = (ip: string) => `sec:ipban:${ip}`;

export async function readIpBanCached(ip: string): Promise<string | null> {
  if (!ip || ip === 'unknown') return null;
  try {
    const cached = await redis.get(ipBanCacheKey(ip));
    if (cached === '0') return null;
    if (cached !== null) return cached; // the stored ban reason
  } catch {
    // Redis hiccup — fall through to the DB rather than fail open on a ban.
  }

  const [row] = await db
    .select({ reason: bannedIps.reason })
    .from(bannedIps)
    .where(eq(bannedIps.ip, ip))
    .limit(1);

  const value = row ? row.reason || 'IP banned' : '0';
  try {
    await redis.setex(ipBanCacheKey(ip), IP_BAN_CACHE_TTL_S, value);
  } catch {
    /* no-op */
  }
  return row ? value : null;
}

/** Drop the cached verdict for one IP. Call from the ban / unban routes. */
export async function invalidateIpBanCache(ip: string): Promise<void> {
  try {
    await redis.del(ipBanCacheKey(ip));
  } catch {
    /* no-op */
  }
}

/**
 * The same reconciliation, for a surface that is not behind
 * `requireModeratorSession` but still branches on staff flags.
 *
 * Messaging does exactly that: it is open to every member, and the staff
 * flags only widen what a member may do — skip the first-contact queue,
 * delete somebody else's message, ignore slow mode, see a `staff`-scoped
 * surface. Read from the sealed cookie those stay true for the seven days
 * the session lives, so a demoted moderator kept every one of them.
 *
 * Mutates the object it is given, which is the session's own `user`, so
 * every later read in the same request sees the live value. A member with
 * no staff flags either way costs one cached Redis read.
 */
export async function reconcileStaffRoles(user: {
  id: string;
  isAdmin?: boolean;
  isModerator?: boolean;
  isOwner?: boolean;
}): Promise<void> {
  const live = await readLiveRoles(user.id);
  if (!live) {
    throw createError({ statusCode: 403, message: 'Account no longer exists' });
  }
  user.isAdmin = live.isAdmin;
  user.isModerator = live.isModerator;
  user.isOwner = live.isOwner;
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
  session.user.isOwner = live.isOwner;
}

/**
 * Require user authentication and check for bans
 */
export async function requireAuthSession(event: H3Event) {
  const session = await requireUserSession(event);

  /**
   * Remember who is acting, for the audit log.
   *
   * Set HERE — on the plain authentication gate — and not in the staff gates
   * below, on purpose. A member who aims a request at `/api/admin/**` and takes
   * a 403 from `requireAdminSession` has already passed this line, so the
   * attempt is recorded with their name on it. That is the row an operator
   * most wants: a privilege escalation being tried is worth more than the
   * hundredth successful ban.
   *
   * The staff flags are re-read from the live role a few lines further down in
   * the staff gates, and they mutate `session.user` in place — so by the time
   * the audit hook reads this object it holds the authoritative role, not the
   * one the sealed cookie asserted.
   */
  event.context.auditActor = session.user;

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
 * The owner, and only the owner.
 *
 * Layered on `requireAdminSession` rather than replacing it, so the failure a
 * caller sees is the most specific one that applies: a member gets "admin
 * access required", an admin gets the message below. Two different problems
 * should not answer with the same sentence.
 *
 * `refreshSessionRoles` has already reconciled the flag against the live
 * (cached) value inside that call, so a sealed cookie from before a transfer
 * cannot carry ownership past it.
 */
export async function requireOwnerSession(event: H3Event) {
  const session = await requireAdminSession(event);

  if (!session.user?.isOwner) {
    throw createError({
      statusCode: 403,
      message: 'Only the instance owner can do this',
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
 * Read-surface authentication (RSS, Torznab, the programmatic API) lives in
 * `utils/account/readKeyAuth.requireReadAccess`.
 *
 * It used to live here as `requireSessionOrApikey`, which accepted `?apikey=`
 * or `?passkey=` against `users.passkey` with no shape check and no
 * lowercasing — while the Torznab gate did both, so the same key could work on
 * one surface and fail on the other. The replacement resolves a session, then
 * the surface's own key, then the announce passkey while an operator still
 * allows it.
 */
