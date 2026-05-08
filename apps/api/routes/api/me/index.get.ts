/**
 * GET /api/me
 *
 * Returns the logged-in user's full profile shape. Same payload as
 * `/api/users/:id` but the client doesn't need to know its own id, and
 * we get a cheap place to fold in the live tracker URL alongside the
 * user record so the profile page renders in one round-trip.
 */
import { db, schema } from '@trackarr/db';
import { eq, sql } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const { user: session } = await requireUserSession(event);

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, session.id),
    columns: {
      id: true,
      username: true,
      isAdmin: true,
      isModerator: true,
      isBanned: true,
      roleId: true,
      uploaded: true,
      downloaded: true,
      invitesRemaining: true,
      lastIp: true,
      createdAt: true,
      lastSeen: true,
    },
  });

  if (!user) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  // Custom role lookup so the page can show the role's name + colour.
  const role = user.roleId
    ? await db.query.roles.findFirst({
        where: eq(schema.roles.id, user.roleId),
      })
    : null;

  // Fold in counts that are useful at the top of the profile but
  // would otherwise need separate round-trips.
  const [uploadsRow, hnrRow] = await Promise.all([
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(schema.torrents)
      .where(eq(schema.torrents.uploaderId, user.id)),
    db
      .select({
        value: sql<{
          total: number;
          active: number;
          hnr: number;
        }>`json_build_object(
          'total', count(*)::int,
          'active', count(*) FILTER (WHERE is_hnr = false AND (seed_time > 0 OR completed_at IS NOT NULL OR is_exempt = true))::int,
          'hnr', count(*) FILTER (WHERE is_hnr = true)::int
        )`,
      })
      .from(schema.hnrTracking)
      .where(eq(schema.hnrTracking.userId, user.id)),
  ]);

  const ratio =
    user.downloaded === 0
      ? user.uploaded > 0
        ? null // null on the wire = "infinite"
        : 0
      : user.uploaded / user.downloaded;

  return {
    id: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    isModerator: user.isModerator,
    isBanned: user.isBanned,
    role,
    uploaded: user.uploaded,
    downloaded: user.downloaded,
    ratio,
    invitesRemaining: user.invitesRemaining,
    lastIp: user.lastIp,
    createdAt: user.createdAt,
    lastSeen: user.lastSeen,
    counts: {
      uploads: uploadsRow[0]?.value ?? 0,
      seeds: hnrRow[0]?.value?.total ?? 0,
      activeSeeds: hnrRow[0]?.value?.active ?? 0,
      hnr: hnrRow[0]?.value?.hnr ?? 0,
    },
  };
});
