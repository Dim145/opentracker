/**
 * Le rôle vivant d'un compte, et son cache.
 *
 * Extrait de `adminAuth.ts` pour une raison précise : `session.ts` doit
 * pouvoir réconcilier les drapeaux de personnel dans `requireUserSession`, et
 * `adminAuth.ts` importe déjà `getSessionId` depuis `session.ts`. Les faire
 * s'importer l'un l'autre marcherait — les déclarations de fonction sont
 * hissées — mais reposerait sur l'ordre d'évaluation des modules, ce qui n'est
 * pas une base pour un contrôle d'autorisation.
 */
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users } from '@trackarr/db/schema';
import { redis } from '../redis/client';

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

export async function readLiveRoles(userId: string): Promise<{
  isAdmin: boolean;
  isModerator: boolean;
  isOwner: boolean;
  /** Voir `users.session_epoch` : la génération courante des sessions. */
  sessionEpoch: number;
} | null> {
  try {
    const cached = await redis.get(roleCacheKey(userId));
    if (cached) {
      const p = JSON.parse(cached) as {
        a: boolean;
        m: boolean;
        o?: boolean;
        e?: number;
      };
      // A payload written before `o` existed is treated as a MISS rather than
      // as `isOwner: false`. Otherwise the deploy that adds ownership answers
      // 403 to the owner for up to the cache TTL — and the one thing that
      // would fix it is the console they cannot reach.
      // Même raisonnement pour `e` que pour `o` ci-dessus : une charge écrite
      // avant que l'époque existe est un ÉCHEC de cache, pas une époque zéro.
      // Sans cela, le déploiement qui ajoute la révocation lirait `0` pendant
      // une minute et accepterait des sessions qu'un membre vient de révoquer.
      if (p.o !== undefined && p.e !== undefined) {
        return {
          isAdmin: !!p.a,
          isModerator: !!p.m,
          isOwner: !!p.o,
          sessionEpoch: p.e,
        };
      }
    }
  } catch {
    /* fall through to DB */
  }
  const [row] = await db
    .select({
      isAdmin: users.isAdmin,
      isModerator: users.isModerator,
      isOwner: users.isOwner,
      sessionEpoch: users.sessionEpoch,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return null;
  try {
    await redis.setex(
      roleCacheKey(userId),
      ROLE_CACHE_TTL_S,
      JSON.stringify({
        a: row.isAdmin,
        m: row.isModerator,
        o: row.isOwner,
        e: row.sessionEpoch,
      })
    );
  } catch {
    /* no-op */
  }
  return {
    isAdmin: row.isAdmin,
    isModerator: row.isModerator,
    isOwner: row.isOwner,
    sessionEpoch: row.sessionEpoch,
  };
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
