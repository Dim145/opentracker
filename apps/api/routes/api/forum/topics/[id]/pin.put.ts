import { db } from '@trackarr/db';
import { forumTopics } from '@trackarr/db/schema';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  const id = getRouterParam(event, 'id');
  // Un schéma, pas `readBody()`. C'étaient les deux dernières routes
  // mutantes de l'arbre sans validation : un PUT sans corps, ou avec un
  // corps JSON `null`, faisait lever un TypeError sur la déréférence — un
  // 500 avec trace là où un 400 suffit.
  const body = await readValidatedBody(
    event,
    z.object({ isPinned: z.boolean() }).strict().parse
  );

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Topic ID is required',
    });
  }

  const topic = await db
    .update(forumTopics)
    .set({ isPinned: !!body.isPinned })
    .where(eq(forumTopics.id, id))
    .returning();

  if (topic.length === 0) {
    throw createError({ statusCode: 404, message: 'Topic not found' });
  }

  return topic[0];
});
