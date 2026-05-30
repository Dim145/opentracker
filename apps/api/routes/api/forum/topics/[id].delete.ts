import { db } from '@trackarr/db';
import { forumTopics } from '@trackarr/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuthSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Topic ID is required',
    });
  }

  const topic = await db.query.forumTopics.findFirst({
    where: eq(forumTopics.id, id),
  });

  if (!topic) {
    throw createError({
      statusCode: 404,
      message: 'Topic not found',
    });
  }

  // Check permissions: Author, Moderator, or Admin
  const isAuthor = topic.authorId === session.user.id;
  const isModerator = session.user.isModerator || session.user.isAdmin;

  if (!isAuthor && !isModerator) {
    throw createError({
      statusCode: 403,
      message: 'You do not have permission to delete this topic',
    });
  }

  // A non-staff author cannot delete a topic a moderator has locked
  // (locking is meant to freeze/preserve the thread — finding: forum
  // lock not enforced on topic delete).
  if (!isModerator && topic.isLocked) {
    throw createError({ statusCode: 403, message: 'This topic is locked' });
  }

  await db.delete(forumTopics).where(eq(forumTopics.id, id));

  return { message: 'Topic deleted' };
});
