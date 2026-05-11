/**
 * DELETE /api/me/notification-channels/:type
 *
 * Removes the user's row for a channel. Also clears any routing rows
 * pointing at the channel so the user doesn't end up with orphan
 * routes (and the dispatcher doesn't waste a round-trip trying to
 * deliver to a row that no longer exists).
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const type = getRouterParam(event, 'type') ?? '';
  if (!type) {
    throw createError({ statusCode: 400, statusMessage: 'Missing channel type' });
  }

  await db
    .delete(schema.userNotificationRouting)
    .where(
      and(
        eq(schema.userNotificationRouting.userId, user.id),
        eq(schema.userNotificationRouting.channelType, type)
      )
    );
  await db
    .delete(schema.userNotificationChannels)
    .where(
      and(
        eq(schema.userNotificationChannels.userId, user.id),
        eq(schema.userNotificationChannels.channelType, type)
      )
    );
  return { ok: true };
});
