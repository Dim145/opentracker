/**
 * GET /api/me/federated-follows  — authenticated.
 *
 * The caller's remote-uploader follows, with peer metadata. Drives the
 * follow-state of the buttons on /federated and a future "following" view.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);

  const rows = await db
    .select({
      id: schema.federatedFollows.id,
      peerId: schema.federatedFollows.peerId,
      remoteUsername: schema.federatedFollows.remoteUsername,
      createdAt: schema.federatedFollows.createdAt,
      peerName: schema.federationPeers.displayName,
      peerBaseUrl: schema.federationPeers.baseUrl,
    })
    .from(schema.federatedFollows)
    .innerJoin(
      schema.federationPeers,
      eq(schema.federatedFollows.peerId, schema.federationPeers.id),
    )
    // Hide follows to de-trusted peers (suspended/blocked/revoked) — only
    // active links surface in the UI.
    .where(
      and(
        eq(schema.federatedFollows.localUserId, session.user.id),
        eq(schema.federationPeers.status, 'active'),
      ),
    )
    .orderBy(desc(schema.federatedFollows.createdAt));

  return { follows: rows };
});
