/**
 * GET /api/me
 *
 * Returns the logged-in user's full profile shape. Same payload as
 * `/api/users/:id` but the client doesn't need to know its own id, and
 * we get a cheap place to fold in the live tracker URL alongside the
 * user record so the profile page renders in one round-trip.
 */
import { db, schema } from '@trackarr/db';
import { eq, sql, desc } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const { user: session } = await requireUserSession(event);

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, session.id),
    columns: {
      id: true,
      username: true,
      displayName: true,
      bio: true,
      isAdmin: true,
      isModerator: true,
      isBanned: true,
      uploaded: true,
      downloaded: true,
      invitesRemaining: true,
      bonusPoints: true,
      lastIp: true,
      showLastSeen: true,
      showAdultContent: true,
      theme: true,
      language: true,
      createdAt: true,
      lastSeen: true,
    },
  });

  if (!user) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  // Self always sees its full role list — the showAsBadge gate is
  // only enforced on /api/users/:id for foreign viewers. Order by
  // role priority desc so the most "important" badge renders first
  // and we have a stable order for the avatar accent fallback.
  const roleRows = await db
    .select({
      id: schema.roles.id,
      name: schema.roles.name,
      color: schema.roles.color,
      icon: schema.roles.icon,
      priority: schema.roles.priority,
      showAsBadge: schema.roles.showAsBadge,
      assignedAt: schema.userRoles.assignedAt,
      assignedManually: schema.userRoles.assignedManually,
    })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.userRoles.userId, user.id))
    .orderBy(desc(schema.roles.priority));

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
    displayName: user.displayName,
    bio: user.bio,
    isAdmin: user.isAdmin,
    isModerator: user.isModerator,
    isBanned: user.isBanned,
    roles: roleRows,
    uploaded: user.uploaded,
    downloaded: user.downloaded,
    ratio,
    invitesRemaining: user.invitesRemaining,
    bonusPoints: user.bonusPoints,
    lastIp: user.lastIp,
    showLastSeen: user.showLastSeen,
    showAdultContent: user.showAdultContent,
    theme: user.theme,
    language: user.language,
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
