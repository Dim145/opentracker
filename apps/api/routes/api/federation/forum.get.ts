/**
 * GET /api/federation/forum  — inbound, S2S.
 *
 * Exposes OUR recent forum topics (read-only, metadata only) to a partner we
 * share `social` with. Each topic carries a link back to the source so the
 * reader follows it home to read/reply. Signed like the catalogue.
 */
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { verifyInboundS2S } from '~~/utils/federation/inbound';

export default defineEventHandler(async (event) => {
  const { config } = await verifyInboundS2S(event, 'social');

  const base = (config.publicUrl || '').replace(/\/$/, '');
  const topics = await db
    .select({
      id: schema.forumTopics.id,
      title: schema.forumTopics.title,
      categoryName: schema.forumCategories.name,
      authorName: schema.users.username,
      createdAt: schema.forumTopics.createdAt,
      updatedAt: schema.forumTopics.updatedAt,
    })
    .from(schema.forumTopics)
    .leftJoin(
      schema.forumCategories,
      eq(schema.forumTopics.categoryId, schema.forumCategories.id),
    )
    .leftJoin(schema.users, eq(schema.forumTopics.authorId, schema.users.id))
    .orderBy(desc(schema.forumTopics.updatedAt))
    .limit(30);

  return {
    ok: true,
    topics: topics.map((t) => ({
      title: t.title,
      categoryName: t.categoryName,
      authorName: t.authorName,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      url: base ? `${base}/forum/topic/${t.id}` : null,
    })),
  };
});
