/**
 * GET /api/forum/stats
 *
 * Powers the masthead on the redesigned `/forum` page. Single round-trip
 * payload of newsroom-style counters plus the five most-recent topics
 * across the entire forum (cross-category).
 *
 * Returned shape:
 *   {
 *     totals: { categories, topics, posts, contributors },
 *     latest: Array<{
 *       id, title, isPinned, isLocked, updatedAt,
 *       category: { id, name, color, icon },
 *       author: { id, username },
 *       replyCount,
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
import { count, countDistinct, desc, eq, inArray } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireUserSession(event);

  // ── Totals — four cheap counts in parallel ─────────────────
  const [
    [{ value: categoriesCount } = { value: 0 }],
    [{ value: topicsCount } = { value: 0 }],
    [{ value: postsCount } = { value: 0 }],
    [{ value: contributorsCount } = { value: 0 }],
  ] = await Promise.all([
    db.select({ value: count() }).from(forumCategories),
    db.select({ value: count() }).from(forumTopics),
    db.select({ value: count() }).from(forumPosts),
    db.select({ value: countDistinct(forumPosts.authorId) }).from(forumPosts),
  ]);

  // ── Latest five topics — page-wide, with category + author + replies ──
  const latestTopics = await db
    .select({
      id: forumTopics.id,
      title: forumTopics.title,
      isPinned: forumTopics.isPinned,
      isLocked: forumTopics.isLocked,
      updatedAt: forumTopics.updatedAt,
      categoryId: forumCategories.id,
      categoryName: forumCategories.name,
      categoryColor: forumCategories.color,
      categoryIcon: forumCategories.icon,
      authorId: users.id,
      authorUsername: users.username,
    })
    .from(forumTopics)
    .innerJoin(forumCategories, eq(forumTopics.categoryId, forumCategories.id))
    .innerJoin(users, eq(forumTopics.authorId, users.id))
    .orderBy(desc(forumTopics.updatedAt))
    .limit(5);

  const latestIds = latestTopics.map((t) => t.id);
  const replyCounts = latestIds.length
    ? await db
        .select({ topicId: forumPosts.topicId, value: count() })
        .from(forumPosts)
        .where(inArray(forumPosts.topicId, latestIds))
        .groupBy(forumPosts.topicId)
    : [];
  const replyCountMap = new Map(replyCounts.map((r) => [r.topicId, r.value]));

  return {
    totals: {
      categories: Number(categoriesCount),
      topics: Number(topicsCount),
      posts: Number(postsCount),
      contributors: Number(contributorsCount),
    },
    latest: latestTopics.map((t) => ({
      id: t.id,
      title: t.title,
      isPinned: t.isPinned,
      isLocked: t.isLocked,
      updatedAt: t.updatedAt,
      category: {
        id: t.categoryId,
        name: t.categoryName,
        color: t.categoryColor,
        icon: t.categoryIcon,
      },
      author: {
        id: t.authorId,
        username: t.authorUsername,
      },
      // Subtract the seed post so "replies" matches what readers expect
      // (the topic itself isn't a "reply").
      replyCount: Math.max(0, Number(replyCountMap.get(t.id) ?? 0) - 1),
    })),
  };
});
