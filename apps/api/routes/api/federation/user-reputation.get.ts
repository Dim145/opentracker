/**
 * GET /api/federation/user-reputation?username=  — inbound, S2S.
 *
 * Returns a partner-facing reputation snapshot for a local user (ratio,
 * volumes, account age, accepted-upload count). Read-only signal — the
 * consumer never folds it into its own economy. Gated on `accounts`.
 */
import { eq, and, sql } from 'drizzle-orm';
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
  if (!peer.sharesWithThem?.accounts) {
    throw createError({ statusCode: 403, message: 'Accounts not shared with this peer' });
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

  const q = getQuery(event);
  const username = typeof q.username === 'string' ? q.username.trim() : '';
  if (!username) throw createError({ statusCode: 400, message: 'username required' });

  const [u] = await db
    .select({
      id: schema.users.id,
      displayName: schema.users.displayName,
      uploaded: schema.users.uploaded,
      downloaded: schema.users.downloaded,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);
  if (!u) throw createError({ statusCode: 404, message: 'User not found' });

  const [counts] = await db
    .select({ uploads: sql<number>`count(*)::int` })
    .from(schema.torrents)
    .where(
      and(
        eq(schema.torrents.uploaderId, u.id),
        eq(schema.torrents.moderationStatus, 'accepted'),
      ),
    );

  const uploaded = Number(u.uploaded ?? 0);
  const downloaded = Number(u.downloaded ?? 0);
  const ratio = downloaded > 0 ? Number((uploaded / downloaded).toFixed(3)) : null;

  return {
    ok: true,
    reputation: {
      displayName: u.displayName,
      uploaded,
      downloaded,
      ratio,
      memberSince: u.createdAt,
      uploadsCount: counts?.uploads ?? 0,
    },
  };
});
