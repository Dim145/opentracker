/**
 * DELETE /api/messaging/room/messages/:id
 *
 * Take a message out of the room. Staff only — unlike a private message,
 * where the author may withdraw their own: the room is a shared space and
 * letting people erase their side of an exchange after the fact makes the
 * log useless to the person who has to read it later.
 *
 * The row is kept and blanked, with `deletedById` recorded.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { publishToRoom } from '~~/utils/messaging/relay';

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.admin);

  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  const updated = await db
    .update(schema.roomMessages)
    .set({ body: '', deletedAt: new Date(), deletedById: user.id })
    .where(eq(schema.roomMessages.id, id))
    .returning({ id: schema.roomMessages.id });

  if (updated.length === 0) {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  // Readers already holding it need to be told, or a removed message stays
  // on every screen that had it until the next reload.
  await publishToRoom({ type: 'room-delete', messageId: id });

  return { ok: true };
});
