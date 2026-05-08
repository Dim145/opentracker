import { db, schema } from '@trackarr/db';
import { eq, sql } from 'drizzle-orm';
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
  const isPrivileged =
    viewer.id === user.id || viewer.isAdmin || viewer.isModerator;
  const visibleLastSeen =
    user.showLastSeen || isPrivileged ? user.lastSeen : null;

  return {
    ...user,
    lastSeen: visibleLastSeen,
    ratio: ratio === Infinity ? null : ratio, // null = infinite
    uploadsCount: uploadsCount[0]?.count || 0,
  };
});
