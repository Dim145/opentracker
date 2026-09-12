import { db } from '@trackarr/db';
import { forumTopics, forumPosts } from '@trackarr/db/schema';
import { eq, asc } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireUserSession(event);
  const id = getRouterParam(event, 'id');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Topic ID is required',
    });
  }

  const topic = await db.query.forumTopics.findFirst({
    where: eq(forumTopics.id, id),
    with: {
      category: true,
      author: {
        columns: {
          id: true,
          username: true,
          isAdmin: true,
          isModerator: true,
        },
      },
      posts: {
        orderBy: [asc(forumPosts.createdAt)],
        with: {
          author: {
            columns: {
              id: true,
              username: true,
              isAdmin: true,
              isModerator: true,
            },
          },
          // Qui, dans le personnel, a réécrit ce message. C'est la SEULE
          // chose qui distingue une intervention d'un auteur qui se relit :
          // `updated_at` bouge dans les deux cas. Sans cette relation ici, la
          // colonne écrite par `posts/[id].patch.ts` ne sort jamais de la
          // base, et la marque n'existe pour personne.
          editedBy: {
            columns: {
              id: true,
              username: true,
            },
          },
        },
      },
    },
  });

  if (!topic) {
    throw createError({
      statusCode: 404,
      message: 'Topic not found',
    });
  }

  return topic;
});
