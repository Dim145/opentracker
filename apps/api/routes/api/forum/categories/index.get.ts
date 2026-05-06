import { db } from '@trackarr/db';
import { forumCategories } from '@trackarr/db/schema';
import { asc } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const categories = await db.query.forumCategories.findMany({
    orderBy: [asc(forumCategories.order)],
    with: {
      topics: {
        limit: 1,
        orderBy: (topics, { desc }) => [desc(topics.updatedAt)],
      },
    },
  });

  return categories;
});
