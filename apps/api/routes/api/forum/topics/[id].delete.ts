import { db } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { forumTopics } from '@trackarr/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuthSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

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

  // Ni un sujet où quelqu'un d'autre a pris la parole : la cascade sur
  // `forum_posts.topic_id` emporterait ses messages avec. Voir
  // `utils/forumDeletion.ts`.
  if (!isModerator) {
    await assertTopicDeletableByAuthor(id, session.user.id);
  }

  await db.delete(forumTopics).where(eq(forumTopics.id, id));

  return { message: 'Topic deleted' };
});
