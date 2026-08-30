/**
 * PATCH /api/messaging/room/messages/:id
 *
 * Fix what you just said in the room.
 *
 * Bounded by a window, unlike a private message. The room has an
 * audience: a message that has been read by four hundred people and
 * answered by six is part of a conversation, and rewriting it hours later
 * changes what those answers appear to be replying to. Fifteen minutes is
 * long enough for a typo and short enough that the thread above it has
 * not moved on.
 *
 * A muted member cannot edit. Otherwise a mute is a pause on new messages
 * and not on speech, since the last one can be rewritten at will.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import {
  activeMute,
  ensureRoom,
  requireRoomAccess,
  slowModeBlock,
} from '~~/utils/messaging/room';
import { publishToRoom } from '~~/utils/messaging/relay';

const BODY_MAX = 1000;
/** Minutes. See the header: this is about the audience, not about trust. */
const EDIT_WINDOW_MINUTES = 15;

const bodySchema = z
  .object({ body: z.string().trim().min(1).max(BODY_MAX) })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireRoomAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const mute = await activeMute(user.id);
  if (mute) {
    throw createError({
      statusCode: 403,
      message: `You are muted in the room until ${mute.until.toISOString()}`,
      data: { mutedUntil: mute.until },
    });
  }

  // Slow mode damps fan-out, and an edit or a reaction fans out to every
  // connected reader exactly like a message does. Enforced here too, on
  // the same bucket rather than a second one: the setting says one action
  // every N seconds, and letting reactions run free while messages waited
  // left the tool with a hole the size of the mutation limiter.
  const wait = await slowModeBlock(user);
  if (wait > 0) {
    throw createError({
      statusCode: 429,
      message: `Slow mode: ${wait}s to wait`,
      data: { retryAfter: wait },
    });
  }

  const messageId = getRouterParam(event, 'id');
  if (!messageId) throw createError({ statusCode: 400, message: 'Missing id' });

  const body = await validateBody(event, bodySchema);
  const room = await ensureRoom();

  const message = await db.query.roomMessages.findFirst({
    where: and(
      eq(schema.roomMessages.id, messageId),
      eq(schema.roomMessages.conversationId, room.id)
    ),
    columns: {
      id: true,
      authorId: true,
      createdAt: true,
      isSystem: true,
      deletedAt: true,
    },
  });
  if (!message) throw createError({ statusCode: 404, message: 'Not found' });
  if (message.authorId !== user.id) {
    throw createError({ statusCode: 403, message: 'Not your message' });
  }
  if (message.isSystem) {
    throw createError({ statusCode: 403, message: 'System messages cannot be edited' });
  }
  if (message.deletedAt) {
    throw createError({ statusCode: 409, message: 'That message was removed' });
  }

  const ageMinutes = (Date.now() - message.createdAt.getTime()) / 60000;
  if (ageMinutes > EDIT_WINDOW_MINUTES) {
    throw createError({
      statusCode: 409,
      // The number is given rather than left as "too old": a refusal that
      // does not say what the rule is produces a second attempt.
      message: `Room messages can only be edited for ${EDIT_WINDOW_MINUTES} minutes`,
    });
  }

  const editedAt = new Date();
  await db
    .update(schema.roomMessages)
    .set({ body: body.body, editedAt })
    // The primary key is composite because the table is partitioned, so
    // both halves go in the predicate — with only the id, Postgres has to
    // scan every partition in the window.
    .where(
      and(
        eq(schema.roomMessages.id, messageId),
        eq(schema.roomMessages.createdAt, message.createdAt)
      )
    );

  await publishToRoom({
    type: 'roomEdit',
    messageId,
    body: body.body,
    editedAt: editedAt.toISOString(),
  });

  return { id: messageId, editedAt };
});
