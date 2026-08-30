/**
 * POST /api/mod/room/pin
 *
 * Pin one message to the top of the room.
 *
 * On the conversation, not as a flag on the message: "the pinned one" is
 * a property of the room, and a boolean per message allows two of them —
 * which is the state every pin feature eventually has to clean up.
 * Pinning a second message replaces the first, because that is what the
 * single column means.
 *
 * Distinct from the site announcement banner, which is a setting and
 * addresses everybody who loads a page. This addresses the room, lives
 * inside its history, and disappears when retention takes the message.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { ensureRoom } from '~~/utils/messaging/room';
import { publishToRoom } from '~~/utils/messaging/relay';

const bodySchema = z.object({ messageId: z.string().uuid() }).strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const body = await validateBody(event, bodySchema);
  const room = await ensureRoom();

  const message = await db.query.roomMessages.findFirst({
    where: and(
      eq(schema.roomMessages.id, body.messageId),
      eq(schema.roomMessages.conversationId, room.id)
    ),
    columns: { id: true, body: true, deletedAt: true },
  });
  if (!message) throw createError({ statusCode: 404, message: 'Not found' });
  if (message.deletedAt) {
    throw createError({
      statusCode: 409,
      message: 'That message was removed',
    });
  }

  const pinnedAt = new Date();
  await db
    .update(schema.conversations)
    .set({ pinnedMessageId: message.id, pinnedAt, pinnedById: user.id })
    .where(eq(schema.conversations.id, room.id));

  await publishToRoom({
    type: 'roomPin',
    messageId: message.id,
    body: message.body,
    pinnedAt: pinnedAt.toISOString(),
  });

  return { ok: true, messageId: message.id, pinnedAt };
});
