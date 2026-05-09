/**
 * PATCH /api/forum/posts/[id]
 *
 * Lets a user edit their own forum post. Admins and moderators can edit
 * any post (used to clean up rule-breaking content without deleting the
 * whole reply).
 *
 * The schema is intentionally narrow — only `content` is mutable.
 * `updatedAt` is bumped server-side so the UI can show an "edited" stamp
 * without trusting client-supplied timestamps.
 */
import { db } from '@trackarr/db';
import { forumPosts } from '@trackarr/db/schema';
import { validateBody, forumPostUpdateSchema } from '~~/utils/schemas';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  const id = getRouterParam(event, 'id');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Post ID is required',
    });
  }

  const body = await validateBody(event, forumPostUpdateSchema);

  const post = await db.query.forumPosts.findFirst({
    where: eq(forumPosts.id, id),
  });

  if (!post) {
    throw createError({ statusCode: 404, message: 'Post not found' });
  }

  // Authorisation: author OR staff. Anything else is a hard 403 — the UI
  // already hides the edit affordance for non-owners, so a request
  // landing here without permission is either an attack or a bug.
  const isOwner = post.authorId === session.user.id;
  const isStaff = session.user.isAdmin || session.user.isModerator;
  if (!isOwner && !isStaff) {
    throw createError({
      statusCode: 403,
      message: 'You can only edit your own posts',
    });
  }

  const [updated] = await db
    .update(forumPosts)
    .set({
      content: body.content,
      updatedAt: new Date(),
    })
    .where(eq(forumPosts.id, id))
    .returning();

  return updated;
});
