import { db, schema } from '@trackarr/db';
import { eq, sql, desc } from 'drizzle-orm';
import { z } from 'zod';

const paramsSchema = z.object({
  id: z.string().min(1),
});

export default defineEventHandler(async (event) => {
  const { user: viewer } = await requireUserSession(event);

  const params = paramsSchema.parse(getRouterParams(event));

  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, params.id),
    columns: {
      id: true,
      username: true,
      displayName: true,
      bio: true,
      isAdmin: true,
      isModerator: true,
      uploaded: true,
      downloaded: true,
      showLastSeen: true,
      createdAt: true,
      lastSeen: true,
    },
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    });
  }

  // Self / staff always see every role attached to the user so they
  // can audit what's there. Foreign viewers only get the rows where
  // the operator opted into a public badge.
  const isPrivileged =
    viewer.id === user.id || viewer.isAdmin || viewer.isModerator;
  const allRoles = await db
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
    .where(eq(schema.userRoles.userId, params.id))
    .orderBy(desc(schema.roles.priority));
  const visibleRoles = isPrivileged
    ? allRoles
    : allRoles.filter((r) => r.showAsBadge);

  // Calculate ratio
  const ratio =
    user.downloaded === 0
      ? user.uploaded > 0
        ? Infinity
        : 1
      : user.uploaded / user.downloaded;

  // Count uploads
  const uploadsCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.torrents)
    .where(eq(schema.torrents.uploaderId, params.id));

  // Privacy: redact `lastSeen` for the public view when the target user
  // has hidden it. Mods/admins keep the real value so moderation isn't
  // blinded by a privacy flag, and a user always sees their own.
  const visibleLastSeen =
    user.showLastSeen || isPrivileged ? user.lastSeen : null;

  return {
    ...user,
    lastSeen: visibleLastSeen,
    ratio: ratio === Infinity ? null : ratio, // null = infinite
    uploadsCount: uploadsCount[0]?.count || 0,
    roles: visibleRoles,
  };
});
