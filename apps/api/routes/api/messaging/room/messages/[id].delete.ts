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
import { ensureRoom } from '~~/utils/messaging/room';

export default defineEventHandler(async (event) => {
  // Staff only, including for your own message — unlike the private
  // surface, where the author may withdraw what they wrote.
  //
  // That difference is deliberate and it is about the audience: a room
  // message has been read by everyone present and answered by some of
  // them, so removing it changes what those answers appear to reply to.
  // A private message has one reader. `tests/e2e/room.mjs` pins this
  // ("the author cannot remove their own — the room is a shared log");
  // the fifteen-minute edit window is the room's answer to a typo.
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

  // A pin pointing at a message that has just been removed is a pin
  // pointing at nothing. The read path already refuses to show it, so
  // the banner disappeared correctly — but the row stayed, and the room
  // was left carrying a dangling pin that no unpin was ever asked for.
  // Cleared here rather than left for the reader to hide.
  const room = await ensureRoom();
  if (room.pinnedMessageId === id) {
    await db
      .update(schema.conversations)
      .set({ pinnedMessageId: null, pinnedAt: null, pinnedById: null })
      .where(eq(schema.conversations.id, room.id));
    await publishToRoom({ type: 'roomPin', messageId: null });
  }

  // Readers already holding it need to be told, or a removed message stays
  // on every screen that had it until the next reload.
  await publishToRoom({ type: 'room-delete', messageId: id });

  return { ok: true };
});
