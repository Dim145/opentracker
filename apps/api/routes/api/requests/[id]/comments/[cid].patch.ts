/**
 * PATCH /api/requests/:id/comments/:cid
 *
 * Author-only edit inside a 15-minute grace window. After the
 * window the comment is frozen — staff don't get an "edit" path
 * (they soft-delete instead, see the DELETE sibling).
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
const bodySchema = z.object({
  body: z.string().min(1).max(4000),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id, cid } = paramsSchema.parse(getRouterParams(event));
  const body = await readValidatedBody(event, bodySchema.parse);

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
    throw createError({ statusCode: 400, message: 'Comment has been removed' });
  }
  if (comment.authorId !== user.id) {
    throw createError({
      statusCode: 403,
      message: 'You can only edit your own comments',
    });
  }
  const age = Date.now() - new Date(comment.createdAt).getTime();
  if (age > EDIT_WINDOW_MS) {
    throw createError({
      statusCode: 400,
      message: 'Comments can only be edited within 15 minutes of posting',
    });
  }

  await db
    .update(schema.uploadRequestComments)
    .set({ body: body.body, editedAt: new Date() })
    .where(eq(schema.uploadRequestComments.id, cid));

  return { success: true };
});
