/**
 * POST /api/users/:id/follow
 *
 * Follow another user. Idempotent — a second POST is a no-op so
 * the client never needs to know about prior state (and a race
 * between two tabs flipping the same row resolves cleanly).
 *
 * Self-follow is rejected for the same reason `POST /reports`
 * rejects self-reports: zero plausible use, infinite noise.
 *
 * The followed user is never notified at this point — the user's
 * answers to the design questions explicitly opt out of a
 * `new_follower` ping. The only notification the followed user
 * ever sees stems from their *own* uploads firing fan-out, never
 * from a relationship change.
 */
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users, userFollows } from '@trackarr/db/schema';
import { requireAuthSession } from '~~/utils/adminAuth';
import { validateParam, uuidSchema } from '~~/utils/schemas';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  const targetId = validateParam(event, 'id', uuidSchema);

  if (targetId === session.user.id) {
    throw createError({
      statusCode: 400,
      message: 'You cannot follow yourself',
    });
  }

  const target = await db.query.users.findFirst({
    where: eq(users.id, targetId),
    columns: { id: true },
  });
  if (!target) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  await db
    .insert(userFollows)
    .values({
      followerId: session.user.id,
      followingId: targetId,
    })
    .onConflictDoNothing();

  return { following: true };
});
