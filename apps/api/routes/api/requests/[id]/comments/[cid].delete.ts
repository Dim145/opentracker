/**
 * DELETE /api/requests/:id/comments/:cid
 *
 * Soft-delete by staff. The row stays in the table so the thread
 * numbering doesn't shift; `body` becomes hidden from non-staff
 * viewers (the GET endpoint redacts it). The author can also
 * delete their own comment within the 15-minute edit window, same
 * as the PATCH path — past that, only staff can clean up.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

const EDIT_WINDOW_MS = 15 * 60 * 1000;

const paramsSchema = z.object({
  id: z.string().uuid(),
  cid: z.string().uuid(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id, cid } = paramsSchema.parse(getRouterParams(event));

  const comment = await db.query.uploadRequestComments.findFirst({
    where: and(
      eq(schema.uploadRequestComments.id, cid),
      eq(schema.uploadRequestComments.requestId, id),
    ),
  });
  if (!comment) {
    throw createError({ statusCode: 404, message: 'Comment not found' });
  }
  if (comment.deletedAt) {
    // Already removed — return 204-equivalent rather than 400 so
    // double-click doesn't surface as an error to the user.
    return { success: true };
  }

  const isStaff = !!(user.isAdmin || user.isModerator);
  const isAuthor = comment.authorId === user.id;
  const inEditWindow =
    isAuthor &&
    Date.now() - new Date(comment.createdAt).getTime() <= EDIT_WINDOW_MS;

  if (!isStaff && !inEditWindow) {
    throw createError({
      statusCode: 403,
      message: 'Only staff can remove this comment',
    });
  }

  await db
    .update(schema.uploadRequestComments)
    .set({ deletedAt: new Date(), deletedById: user.id })
    .where(eq(schema.uploadRequestComments.id, cid));

  return { success: true };
});
