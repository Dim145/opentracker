/**
 * POST /api/admin/users/:id/unban
 *
 * Hierarchy:
 *   - Admins can lift any ban.
 *   - Moderators can only lift bans they (or another moderator)
 *     issued — never an admin-issued ban. Without this guard, a
 *     compromised mod account could undo every admin moderation
 *     decision.
 *
 * The check reads the `bannedByRole` field set on `users` at ban
 * time, so subsequent role changes on the issuer don't loosen the
 * gate.
 */
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users, bannedIps } from '@trackarr/db/schema';
import { invalidateBanCache, requireModeratorSession } from '~~/utils/adminAuth';
import { validateParam, uuidSchema } from '~~/utils/schemas';
import { notify } from '~~/utils/notify';

export default defineEventHandler(async (event) => {
  const { user: actor } = await requireModeratorSession(event);
  const userId = validateParam(event, 'id', uuidSchema);

  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!target) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  if (
    target.bannedByRole === 'admin' &&
    !actor.isAdmin
  ) {
    throw createError({
      statusCode: 403,
      message: 'This ban was issued by an admin and can only be lifted by an admin',
    });
  }

  await db
    .update(users)
    .set({ isBanned: false, bannedById: null, bannedByRole: null })
    .where(eq(users.id, userId));

  // Drop the cached `isBanned` so the unbanned user can sign in
  // again on the very next attempt rather than waiting for the TTL.
  await invalidateBanCache(userId);

  if (target.lastIp) {
    await db.delete(bannedIps).where(eq(bannedIps.ip, target.lastIp));
  }

  void notify(target.id, 'account_unbanned', {
    actorUsername: actor.username,
  });

  return { success: true };
});
