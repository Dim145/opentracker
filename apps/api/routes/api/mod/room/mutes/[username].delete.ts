/**
 * DELETE /api/mod/room/mutes/:username — lift a mute early.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.admin);

  const username = getRouterParam(event, 'username');
  if (!username) throw createError({ statusCode: 400, message: 'Missing username' });

  const target = await db.query.users.findFirst({
    where: eq(schema.users.username, username),
    columns: { id: true },
  });
  if (!target) throw createError({ statusCode: 404, message: 'No such member' });

  await db.delete(schema.roomMutes).where(eq(schema.roomMutes.userId, target.id));
  return { ok: true };
});
