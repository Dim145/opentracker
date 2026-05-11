import { db } from '@trackarr/db';
import { forumPosts, forumTopics } from '@trackarr/db/schema';
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { validateBody, forumPostSchema } from '~~/utils/schemas';
import { notify } from '~~/utils/notify';

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);

  // Validate request body with Zod
  const body = await validateBody(event, forumPostSchema);

  const topic = await db.query.forumTopics.findFirst({
    where: eq(forumTopics.id, body.topicId),
  });

  if (!topic) {
    throw createError({
      statusCode: 404,
      message: 'Topic not found',
    });
  }

  if (topic.isLocked && !session.user.isAdmin && !session.user.isModerator) {
    throw createError({
      statusCode: 403,
      message: 'Topic is locked',
    });
  }

  const result = await db.transaction(async (tx) => {
    const post = await tx
      .insert(forumPosts)
      .values({
        id: uuidv4(),
        topicId: body.topicId,
        authorId: session.user.id,
        content: body.content,
      })
      .returning();

    // Update topic's updatedAt timestamp
    await tx
      .update(forumTopics)
      .set({ updatedAt: new Date() })
      .where(eq(forumTopics.id, body.topicId));

    return post[0];
  });

  // Notify the topic author when someone else replies. Self-reply
  // (the author following up their own thread) is silenced.
  if (topic.authorId && topic.authorId !== session.user.id) {
    void notify(
      topic.authorId,
      'forum_reply_on_my_topic',
      {
        topicTitle: topic.title,
        topicId: topic.id,
        actorUsername: session.user.username,
        preview: body.content.slice(0, 200),
      },
      `/forum/topic/${topic.id}`,
    );
  }

  return result;
});
