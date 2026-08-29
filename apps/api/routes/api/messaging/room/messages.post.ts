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
import { eq } from 'drizzle-orm';
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

  await db.insert(schema.roomMessages).values({
    id,
    conversationId: room.id,
    authorId: user.id,
    body: body.body,
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
      author: {
        id: user.id,
        username: user.username,
        displayName: user.displayName ?? null,
      },
    },
  });

  return { id, createdAt: now };
});
