/**
 * GET /api/messaging/room
 *
 * The room, newest first, by cursor. Also carries what the composer needs
 * to behave: whether this member is silenced, and whether slow mode is on.
 *
 * Sending those with the page rather than making the client discover them
 * on a rejected send is deliberate — a composer that lets you type a
 * paragraph and then refuses it is worse than one that says up front.
 */
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateQuery } from '~~/utils/schemas';
import { getRoomSlowModeSeconds } from '~~/utils/settings';
import { activeMute, requireRoomAccess, roomPage } from '~~/utils/messaging/room';

const querySchema = z.object({
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireRoomAccess(user);
  await rateLimit(event, RATE_LIMITS.public);

  const query = validateQuery(event, querySchema);
  const page = await roomPage({ before: query.before, limit: query.limit });
  const mute = await activeMute(user.id);

  return {
    ...page,
    slowModeSeconds: await getRoomSlowModeSeconds(),
    mutedUntil: mute?.until ?? null,
  };
});
