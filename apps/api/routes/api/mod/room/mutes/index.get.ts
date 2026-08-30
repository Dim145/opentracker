/**
 * GET /api/mod/room/mutes
 *
 * Who is silenced in the room, and until when.
 *
 * `/unmute` takes a name, and there was nowhere to read one: a moderator
 * who muted somebody for a day and came back to a different shift had a
 * command they could not use. A mute is bounded so it expires on its own,
 * but "wait it out" is not the same as being able to lift it.
 *
 * Expired rows are left in the table — the insert upserts on the user, so
 * they cost nothing — and filtered here, because a list of mutes that are
 * no longer in force is a list of names to unmute for nothing.
 */
import { db, schema } from '@trackarr/db';
import { eq, gt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const actor = alias(schema.users, 'muted_by');
  const rows = await db
    .select({
      username: schema.users.username,
      displayName: schema.users.displayName,
      until: schema.roomMutes.until,
      reason: schema.roomMutes.reason,
      by: actor.username,
    })
    .from(schema.roomMutes)
    .innerJoin(schema.users, eq(schema.users.id, schema.roomMutes.userId))
    .leftJoin(actor, eq(actor.id, schema.roomMutes.byId))
    .where(gt(schema.roomMutes.until, new Date()))
    .orderBy(schema.roomMutes.until);

  return { mutes: rows };
});
