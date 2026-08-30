/**
 * POST /api/messaging/room/messages/:id/reactions
 *
 * Toggle a reaction in the room. Same contract as the private one.
 *
 * This is the surface where a reaction earns its place: it is what
 * replaces twenty separate "+1" lines, each of which would be a row, a
 * publish and a fan-out to every reader. It can also do the opposite —
 * reacting is cheaper than typing — which is why the key set is fixed and
 * the frame is a delta.
 *
 * A muted member cannot react. Silencing somebody who can still stamp
 * every message is not silencing them.
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
import { REACTION_KEYS, toggleRoomReaction } from '~~/utils/messaging/reactions';

const bodySchema = z.object({ key: z.enum(REACTION_KEYS) }).strict();

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

  // `createdAt` is not decoration here: it is the partition key of the
  // reaction row, so the reaction lands in the same day's partition as
  // the message and is dropped with it.
  const message = await db.query.roomMessages.findFirst({
    where: and(
      eq(schema.roomMessages.id, messageId),
      eq(schema.roomMessages.conversationId, room.id)
    ),
    columns: { id: true, createdAt: true, deletedAt: true },
  });
  if (!message) throw createError({ statusCode: 404, message: 'Not found' });
  if (message.deletedAt) {
    throw createError({ statusCode: 409, message: 'That message was removed' });
  }

  const action = await toggleRoomReaction(
    messageId,
    message.createdAt,
    user.id,
    body.key
  );

  await publishToRoom({
    type: 'roomReaction',
    messageId,
    key: body.key,
    delta: action === 'added' ? 1 : -1,
    userId: user.id,
  });

  return { key: body.key, action };
});
