/**
 * DELETE /api/admin/banned-ips/:ip
 *
 * Remove an entry from the IP blocklist. Returning 200 even when the
 * row didn't exist keeps the admin UI's optimistic-update path simple
 * — we don't want a no-op delete to bubble a confusing error toast.
 *
 * Auth: moderator+. Rate-limited via the standard mutation bucket.
 *
 * Note: this does NOT un-ban any user account whose `lastIp` matches.
 * If you want both removed at once, use POST /api/admin/users/:id/unban
 * which deletes the user-flag AND the bannedIps row in one transaction.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { isIP } from 'node:net';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const ip = getRouterParam(event, 'ip')?.trim() || '';
  if (!ip || isIP(ip) === 0) {
    throw createError({
      statusCode: 400,
      message: 'Invalid IP address',
    });
  }

  const result = await db
    .delete(schema.bannedIps)
    .where(eq(schema.bannedIps.ip, ip))
    .returning({ ip: schema.bannedIps.ip });

  return {
    success: true,
    removed: result.length > 0,
  };
});
