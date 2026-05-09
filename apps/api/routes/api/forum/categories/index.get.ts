/**
 * GET /api/forum/categories
 *
 * Powers the redesigned `/forum` newsroom page. The original endpoint
 * only returned categories with a single recent topic stub — the rebuild
 * needs proper counts and a real last-post pointer (author + snippet)
 * so each tile can render at-a-glance activity instead of just a date.
 *
 * Returned shape per category:
 *   {
 *     id, name, description, color, icon, order, createdAt,
 *     topicCount, postCount,
 *     lastTopic: { id, title, updatedAt, isPinned, isLocked, authorUsername } | null,
 *     lastPost:  { topicId, topicTitle, content, createdAt, authorUsername } | null,
 *   }
 *
 * Auth: members-only (private tracker).
 */
import { db } from '@trackarr/db';
import {
  forumCategories,
  forumTopics,
  forumPosts,
  users,
} from '@trackarr/db/schema';
import { asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

type CategoryRow = typeof forumCategories.$inferSelect;

export default defineEventHandler(async (event) => {
  await requireUserSession(event);

  const categories = await db
    .select()
    .from(forumCategories)
    .orderBy(asc(forumCategories.order), asc(forumCategories.name));

  if (categories.length === 0) return [] as Array<CategoryRow>;

  const categoryIds = categories.map((c) => c.id);

  // ── Per-category aggregates in parallel ──────────────────────
  // Topic counts come straight from forum_topics. Post counts join through
  // topics so they sum every reply across the category. Both queries are
  // bounded to the in-page set via inArray on uuid PKs (cheap).
  const [topicCounts, postCounts] = await Promise.all([
    db
      .select({
        categoryId: forumTopics.categoryId,
        value: count(),
      })
      .from(forumTopics)
      .where(inArray(forumTopics.categoryId, categoryIds))
      .groupBy(forumTopics.categoryId),
    db
      .select({
        categoryId: forumTopics.categoryId,
        value: count(),
      })
      .from(forumPosts)
      .innerJoin(forumTopics, eq(forumPosts.topicId, forumTopics.id))
      .where(inArray(forumTopics.categoryId, categoryIds))
      .groupBy(forumTopics.categoryId),
  ]);

  // For the raw `db.execute` calls we need a Postgres-array literal, not
  // a JS array. `sql.join` builds an `IN (a, b, c)` parameter list that
  // Postgres binds correctly under driver-prepared statements.
  const idList = sql.join(
    categoryIds.map((id) => sql`${id}`),
    sql`, `
  );

  const topicCountMap = new Map(topicCounts.map((r) => [r.categoryId, r.value]));
  const postCountMap = new Map(postCounts.map((r) => [r.categoryId, r.value]));

  // ── Last topic per category ─────────────────────────────────
  // We pick the most-recently-updated topic in each category. DISTINCT ON
  // is the natural Postgres expression but Drizzle's query builder needs a
  // raw SQL block here; the join brings in the author username so the UI
  // doesn't need a follow-up lookup.
  const lastTopicsRaw = await db.execute<{
    category_id: string;
    topic_id: string;
    title: string;
    updated_at: Date;
    is_pinned: boolean;
    is_locked: boolean;
    author_username: string;
  }>(sql`
    SELECT DISTINCT ON (t.category_id)
      t.category_id,
      t.id AS topic_id,
      t.title,
      t.updated_at,
      t.is_pinned,
      t.is_locked,
      u.username AS author_username
    FROM ${forumTopics} t
    JOIN ${users} u ON u.id = t.author_id
    WHERE t.category_id IN (${idList})
    ORDER BY t.category_id, t.updated_at DESC
  `);

  const lastTopicMap = new Map(
    (lastTopicsRaw as any).rows
      ? (lastTopicsRaw as any).rows.map((r: any) => [r.category_id, r])
      : (lastTopicsRaw as unknown as Array<any>).map((r: any) => [r.category_id, r])
  );

  // ── Last post per category ─────────────────────────────────
  // Independent of the last *topic* — the latest activity might be a reply
  // to an older thread. We grab the post's text snippet so the index card
  // can show a 100-char preview underneath the metadata.
  const lastPostsRaw = await db.execute<{
    category_id: string;
    topic_id: string;
    topic_title: string;
    content: string;
    created_at: Date;
    author_username: string;
  }>(sql`
    SELECT DISTINCT ON (t.category_id)
      t.category_id,
      t.id AS topic_id,
      t.title AS topic_title,
      p.content,
      p.created_at,
      u.username AS author_username
    FROM ${forumPosts} p
    JOIN ${forumTopics} t ON t.id = p.topic_id
    JOIN ${users} u ON u.id = p.author_id
    WHERE t.category_id IN (${idList})
    ORDER BY t.category_id, p.created_at DESC
  `);

  const lastPostMap = new Map(
    (lastPostsRaw as any).rows
      ? (lastPostsRaw as any).rows.map((r: any) => [r.category_id, r])
      : (lastPostsRaw as unknown as Array<any>).map((r: any) => [r.category_id, r])
  );

  // ── Project ─────────────────────────────────────────────────
  return categories.map((cat) => {
    const lt = lastTopicMap.get(cat.id) as any | undefined;
    const lp = lastPostMap.get(cat.id) as any | undefined;
    return {
      ...cat,
      topicCount: Number(topicCountMap.get(cat.id) ?? 0),
      postCount: Number(postCountMap.get(cat.id) ?? 0),
      lastTopic: lt
        ? {
            id: lt.topic_id,
            title: lt.title,
            updatedAt: lt.updated_at,
            isPinned: lt.is_pinned,
            isLocked: lt.is_locked,
            authorUsername: lt.author_username,
          }
        : null,
      lastPost: lp
        ? {
            topicId: lp.topic_id,
            topicTitle: lp.topic_title,
            content: lp.content,
            createdAt: lp.created_at,
            authorUsername: lp.author_username,
          }
        : null,
    };
  });
});
