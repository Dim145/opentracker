/**
 * GET /api/forum/categories/[id]
 *
 * Powers the redesigned category page. The original returned topics with
 * just their author; the rebuild surfaces enough metadata for editorial
 * cards: reply count, the seed post excerpt (so readers can preview
 * threads inline), and the last-post pointer (author + when).
 *
 * Returned shape:
 *   {
 *     ...categoryRow (incl. color, icon),
 *     topics: Array<{
 *       id, title, isPinned, isLocked, createdAt, updatedAt,
 *       author: { id, username },
 *       replyCount,
 *       firstPostExcerpt: string | null,    // ~200 char snippet, no MD
 *       lastPost: { authorUsername, createdAt } | null,
 *     }>
 *   }
 *
 * Auth: members-only.
 */
import { db } from '@trackarr/db';
import {
  forumCategories,
  forumPosts,
  forumTopics,
  users,
} from '@trackarr/db/schema';
import { asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireUserSession(event);
  const id = getRouterParam(event, 'id');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Category ID is required',
    });
  }

  const category = await db.query.forumCategories.findFirst({
    where: eq(forumCategories.id, id),
    with: {
      topics: {
        // Pinned topics float; otherwise newest activity first.
        orderBy: [desc(forumTopics.isPinned), desc(forumTopics.updatedAt)],
        with: {
          author: { columns: { id: true, username: true } },
        },
      },
    },
  });

  if (!category) {
    throw createError({
      statusCode: 404,
      message: 'Category not found',
    });
  }

  if (category.topics.length === 0) {
    return { ...category, topics: [] };
  }

  const topicIds = category.topics.map((t) => t.id);

  // ── Per-topic post counts ───────────────────────────────────
  const postCounts = await db
    .select({
      topicId: forumPosts.topicId,
      value: count(),
    })
    .from(forumPosts)
    .where(inArray(forumPosts.topicId, topicIds))
    .groupBy(forumPosts.topicId);
  const postCountMap = new Map(postCounts.map((r) => [r.topicId, r.value]));

  // Drizzle's sql template doesn't expand JS arrays into Postgres
  // arrays, so we build an IN-list parameter manually for the raw
  // queries below.
  const idList = sql.join(
    topicIds.map((id) => sql`${id}`),
    sql`, `
  );

  // ── First-post excerpt per topic ────────────────────────────
  // The "first" post is the one the author wrote when they created the
  // topic — same author_id as the topic, oldest createdAt. We trim hard
  // to 200 chars so the cards don't bloat vertically.
  const firstPostsRaw = await db.execute<{
    topic_id: string;
    content: string;
  }>(sql`
    SELECT DISTINCT ON (p.topic_id)
      p.topic_id,
      p.content
    FROM ${forumPosts} p
    WHERE p.topic_id IN (${idList})
    ORDER BY p.topic_id, p.created_at ASC
  `);
  const firstPostMap = new Map<string, string>();
  const firstPostRows = (firstPostsRaw as any).rows ?? firstPostsRaw;
  for (const r of firstPostRows as Array<{ topic_id: string; content: string }>) {
    const trimmed = (r.content || '').replace(/\s+/g, ' ').trim();
    firstPostMap.set(
      r.topic_id,
      trimmed.length > 200 ? trimmed.slice(0, 200) + '…' : trimmed
    );
  }

  // ── Last-post author + timestamp per topic ─────────────────
  const lastPostsRaw = await db.execute<{
    topic_id: string;
    created_at: Date;
    author_username: string;
  }>(sql`
    SELECT DISTINCT ON (p.topic_id)
      p.topic_id,
      p.created_at,
      u.username AS author_username
    FROM ${forumPosts} p
    JOIN ${users} u ON u.id = p.author_id
    WHERE p.topic_id IN (${idList})
    ORDER BY p.topic_id, p.created_at DESC
  `);
  const lastPostMap = new Map<
    string,
    { authorUsername: string; createdAt: Date }
  >();
  const lastPostRows = (lastPostsRaw as any).rows ?? lastPostsRaw;
  for (const r of lastPostRows as Array<{
    topic_id: string;
    created_at: Date;
    author_username: string;
  }>) {
    lastPostMap.set(r.topic_id, {
      authorUsername: r.author_username,
      createdAt: r.created_at,
    });
  }

  return {
    ...category,
    topics: category.topics.map((topic) => ({
      id: topic.id,
      title: topic.title,
      isPinned: topic.isPinned,
      isLocked: topic.isLocked,
      createdAt: topic.createdAt,
      updatedAt: topic.updatedAt,
      author: topic.author,
      // Subtract one because the seed post isn't a "reply".
      replyCount: Math.max(0, Number(postCountMap.get(topic.id) ?? 0) - 1),
      firstPostExcerpt: firstPostMap.get(topic.id) ?? null,
      lastPost: lastPostMap.get(topic.id) ?? null,
    })),
  };
});
