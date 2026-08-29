/**
 * POST /api/mod/room/mutes
 *
 * Silence a member in the room for a while.
 *
 * Bounded rather than indefinite: an unbounded mute is a ban applied
 * without the process a ban goes through, and it tends to be forgotten
 * rather than lifted.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';

const MAX_MUTE_HOURS = 24 * 7;

const bodySchema = z
  .object({
    username: z.string().trim().min(1).max(64),
    hours: z.number().min(0.25).max(MAX_MUTE_HOURS),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user: actor } = await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.admin);

  const body = await validateBody(event, bodySchema);
  const target = await db.query.users.findFirst({
    where: eq(schema.users.username, body.username),
    columns: { id: true, isAdmin: true, isModerator: true },
  });
  if (!target) throw createError({ statusCode: 404, message: 'No such member' });
  // Staff do not silence staff here. Whatever the disagreement, it is not
  // one this endpoint should settle.
  if (target.isAdmin || target.isModerator) {
    throw createError({ statusCode: 403, message: 'Cannot mute staff' });
  }

  const until = new Date(Date.now() + body.hours * 3600 * 1000);
  await db
    .insert(schema.roomMutes)
    .values({ userId: target.id, until, byId: actor.id, reason: body.reason ?? null })
    .onConflictDoUpdate({
      target: schema.roomMutes.userId,
      set: { until, byId: actor.id, reason: body.reason ?? null },
    });

  return { ok: true, until };
});
