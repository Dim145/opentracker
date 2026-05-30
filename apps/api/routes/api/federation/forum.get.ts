/**
 * GET /api/federation/forum  — inbound, S2S.
 *
 * Exposes OUR recent forum topics (read-only, metadata only) to a partner we
 * share `social` with. Each topic carries a link back to the source so the
 * reader follows it home to read/reply. Signed like the catalogue.
 */
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  getFederationConfig,
  isFederationLive,
} from '~~/utils/federation/config';
import { verifySignedRequest } from '~~/utils/federation/signing';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.public);

  const config = await getFederationConfig();
  if (!isFederationLive(config)) {
    throw createError({ statusCode: 404, message: 'Federation not enabled' });
  }

  const headers = getRequestHeaders(event);
  const senderId = headers['x-trackarr-instance'];
  if (!senderId) {
    throw createError({ statusCode: 401, message: 'Missing instance header' });
  }

  const [peer] = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.instanceId, senderId))
    .limit(1);
  if (!peer || !peer.publicKey) {
    throw createError({ statusCode: 404, message: 'Unknown peer' });
  }
  if (peer.status !== 'active') {
    throw createError({ statusCode: 403, message: 'Peer not active' });
  }
  if (!peer.sharesWithThem?.social) {
    throw createError({ statusCode: 403, message: 'Social not shared with this peer' });
  }

  const verdict = verifySignedRequest({
    method: 'GET',
    pathname: event.path,
    rawBody: '',
    headers,
    publicKeyPem: peer.publicKey,
  });
  if (!verdict.ok) {
    throw createError({
      statusCode: 401,
      message: `Signature rejected: ${verdict.reason}`,
    });
  }

  const base = (config!.publicUrl || '').replace(/\/$/, '');
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
