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
import { isLegacyPasskeyReadAllowed } from '~~/utils/settings';

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
      bonusUploaded: true,
      downloaded: true,
      invitesRemaining: true,
      bonusPoints: true,
      lastIp: true,
      showLastSeen: true,
      showAdultContent: true,
      anonymousUploads: true,
      hideDownloadHistory: true,
      restrictComments: true,
      shareReputationFederated: true,
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
  const [uploadsRow, hnrRow, legacyPasskeyAccepted] = await Promise.all([
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
    isLegacyPasskeyReadAllowed(),
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
    bonusUploaded: user.bonusUploaded,
    downloaded: user.downloaded,
    ratio,
    invitesRemaining: user.invitesRemaining,
    bonusPoints: user.bonusPoints,
    lastIp: user.lastIp,
    showLastSeen: user.showLastSeen,
    showAdultContent: user.showAdultContent,
    anonymousUploads: user.anonymousUploads,
    hideDownloadHistory: user.hideDownloadHistory,
    restrictComments: user.restrictComments,
    shareReputationFederated: user.shareReputationFederated,
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
    /**
     * Whether the announce passkey still opens the read surfaces.
     *
     * A site setting, not a secret, and it lives here because the only other
     * place that returned it was `GET /api/me/keys` — which MINTS the two read
     * keys on first read. So the banner telling a member their passkey is still
     * accepted on feeds, and that they should migrate, appeared only after they
     * revealed or copied an RSS key: only after they had already found the thing
     * the banner exists to point them at. The member who most needs it — still
     * using their passkey in Prowlarr, never opened the RSS card — never saw it.
     * Fetching `/api/me/keys` eagerly instead would have minted a key for every
     * member who opens their profile, which is the decision that route exists to
     * avoid.
     */
    legacyPasskeyAccepted,
  };
});
