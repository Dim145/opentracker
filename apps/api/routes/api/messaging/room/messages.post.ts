/**
 * POST /api/messaging/room/messages
 *
 * Say something in the room.
 *
 * Three gates, in the order that costs least: silenced, then slow mode,
 * then the write. Slow mode is counted in Valkey with a self-expiring key
 * rather than a column, because it is read on every send during exactly
 * the moments the room is busiest.
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
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

const bodySchema = z
  .object({
    body: z.string().trim().min(1).max(BODY_MAX),
    /**
     * The message being answered. The room is one flat channel, so this
     * is what keeps it readable once more than a handful of people are
     * talking at once — without it every reply is addressed to whoever
     * happens to be above it.
     */
    replyToId: z.string().uuid().optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireRoomAccess(user);
  await rateLimit(event, RATE_LIMITS.mutation);

  const mute = await activeMute(user.id);
  if (mute) {
    throw createError({
      statusCode: 403,
      // The end time is given: being silenced without knowing for how long
      // reads as a ban, and produces a support message rather than a wait.
      message: `You are muted in the room until ${mute.until.toISOString()}`,
      data: { mutedUntil: mute.until },
    });
  }

  const wait = await slowModeBlock(user);
  if (wait > 0) {
    throw createError({
      statusCode: 429,
      message: `Slow mode: ${wait}s to wait`,
      data: { retryAfter: wait },
    });
  }

  const body = await validateBody(event, bodySchema);
  const room = await ensureRoom();
  const now = new Date();
  const id = randomUUID();

  // Checked against this room, and against retention: quoting a message
  // whose day has already been dropped would render as a quote of
  // nothing. Refusing is clearer than showing a hole.
  if (body.replyToId) {
    const target = await db.query.roomMessages.findFirst({
      where: and(
        eq(schema.roomMessages.id, body.replyToId),
        eq(schema.roomMessages.conversationId, room.id)
      ),
      columns: { id: true },
    });
    if (!target) {
      throw createError({
        statusCode: 400,
        message: 'The message being replied to is no longer in the room',
      });
    }
  }

  await db.insert(schema.roomMessages).values({
    id,
    conversationId: room.id,
    authorId: user.id,
    body: body.body,
    replyToId: body.replyToId ?? null,
    createdAt: now,
  });
  await db
    .update(schema.conversations)
    .set({ lastMessageAt: now })
    .where(eq(schema.conversations.id, room.id));

  // One channel for the whole room, and the fan-out happens on the relay
  // nodes: a publish costs O(nodes), not O(readers).
  await publishToRoom({
    type: 'room',
    message: {
      id,
      body: body.body,
      createdAt: now,
      replyToId: body.replyToId ?? null,
      author: {
        id: user.id,
        username: user.username,
        displayName: user.displayName ?? null,
      },
    },
  });

  return { id, createdAt: now };
});
