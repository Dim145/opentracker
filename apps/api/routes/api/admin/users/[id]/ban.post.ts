/**
 * POST /api/admin/users/:id/ban
 *
 * Hierarchy:
 *   - Admins can ban any non-admin (including moderators).
 *   - Moderators can only ban regular users — not admins, not other
 *     moderators, not themselves. The previous version let any mod
 *     ban any non-admin, including peer moderators.
 *
 * Tracking: we record `bannedById` and `bannedByRole` so the
 * sibling unban route can refuse a moderator trying to lift an
 * admin-issued ban.
 */
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users, bannedIps } from '@trackarr/db/schema';
import { invalidateBanCache, requireModeratorSession } from '~~/utils/adminAuth';
import {
  validateBody,
  validateParam,
  adminBanSchema,
  uuidSchema,
} from '~~/utils/schemas';
import { notify } from '~~/utils/notify';

export default defineEventHandler(async (event) => {
  const { user: actor } = await requireModeratorSession(event);
  const userId = validateParam(event, 'id', uuidSchema);
  const body = await validateBody(event, adminBanSchema);
  const reason = body.reason || 'Banned by admin';

  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!target) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  if (actor.id === target.id) {
    throw createError({ statusCode: 400, message: 'You cannot ban yourself' });
  }
  if (target.isAdmin) {
    throw createError({ statusCode: 403, message: 'Cannot ban an admin' });
  }
  if (target.isModerator && !actor.isAdmin) {
    throw createError({
      statusCode: 403,
      message: 'Only admins can ban a moderator',
    });
  }

  await db
    .update(users)
    .set({
      isBanned: true,
      bannedById: actor.id,
      bannedByRole: actor.isAdmin ? 'admin' : 'moderator',
    })
    .where(eq(users.id, userId));

  // Drop the cached `isBanned` so the lockout takes effect on the
  // very next request rather than waiting up to 60 s for the TTL.
  await invalidateBanCache(userId);

  if (target.lastIp) {
    const banReason = `Banned user: ${target.username}. Reason: ${reason}`;
    await db
      .insert(bannedIps)
      .values({ ip: target.lastIp, reason: banReason })
      .onConflictDoUpdate({
        target: bannedIps.ip,
        set: { reason: banReason },
      });
  }

  // Notify the banned user. They won't see it until they try to log
  // back in (auth middleware blocks the session) — but it'll be
  // there when they're unbanned. Also notify the inviter if the
  // ban targets one of their invitees.
  void notify(target.id, 'account_banned', {
    reason,
    actorUsername: actor.username,
  });
  try {
    const invite = await db.query.invitations.findFirst({
      where: (i, { eq }) => eq(i.usedBy, target.id),
      columns: { generatedBy: true, code: true },
    });
    if (invite?.generatedBy && invite.generatedBy !== actor.id) {
      void notify(invite.generatedBy, 'invitee_banned', {
        inviteeUsername: target.username,
        inviteCode: invite.code,
        reason,
      });
    }
  } catch (err) {
    console.warn('[Ban] invitee notify failed:', (err as Error).message);
  }

  return { success: true };
});
