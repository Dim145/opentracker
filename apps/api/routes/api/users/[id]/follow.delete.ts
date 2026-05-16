/**
 * DELETE /api/users/:id/follow
 *
 * Stop following another user. Silent if the row was never there
 * — same idempotency contract as the sibling POST, so the client
 * doesn't need to track prior state.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { userFollows } from '@trackarr/db/schema';
import { requireAuthSession } from '~~/utils/adminAuth';
import { validateParam, uuidSchema } from '~~/utils/schemas';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  const targetId = validateParam(event, 'id', uuidSchema);

  await db
    .delete(userFollows)
    .where(
      and(
        eq(userFollows.followerId, session.user.id),
        eq(userFollows.followingId, targetId),
      ),
    );

  return { following: false };
});
