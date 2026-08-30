/**
 * DELETE /api/mod/room/pin
 *
 * Take the pin down. Idempotent: unpinning nothing is not an error, so a
 * second click from a stale view does not produce a failure to explain.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { ensureRoom } from '~~/utils/messaging/room';
import { publishToRoom } from '~~/utils/messaging/relay';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const room = await ensureRoom();
  await db
    .update(schema.conversations)
    .set({ pinnedMessageId: null, pinnedAt: null, pinnedById: null })
    .where(eq(schema.conversations.id, room.id));

  await publishToRoom({ type: 'roomPin', messageId: null });

  return { ok: true };
});
