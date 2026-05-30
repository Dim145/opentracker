import { db } from '@trackarr/db';
import { forumTopics } from '@trackarr/db/schema';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  const id = getRouterParam(event, 'id');
  const body = await readBody(event);

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Topic ID is required',
    });
  }

  const topic = await db
    .update(forumTopics)
    .set({ isLocked: !!body.isLocked })
    .where(eq(forumTopics.id, id))
    .returning();

  // Unknown id → no row updated. Return 404 instead of a 200 with an
  // empty body so callers get a deterministic result.
  if (topic.length === 0) {
    throw createError({ statusCode: 404, message: 'Topic not found' });
  }

  return topic[0];
});
