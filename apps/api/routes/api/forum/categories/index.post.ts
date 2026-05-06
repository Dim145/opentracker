import { db } from '@trackarr/db';
import { forumCategories } from '@trackarr/db/schema';
import { requireAdminSession } from '~~/utils/adminAuth';
import { v4 as uuidv4 } from 'uuid';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const body = await readBody(event);

  if (!body.name) {
    throw createError({
      statusCode: 400,
      message: 'Name is required',
    });
  }

  const category = await db
    .insert(forumCategories)
    .values({
      id: uuidv4(),
      name: body.name,
      description: body.description,
      order: body.order || 0,
    })
    .returning();

  return category[0];
});
