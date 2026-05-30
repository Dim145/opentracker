/**
 * DELETE /api/admin/federation/peers/:id
 *
 * Owner tears a link down — rejects a pending request OR revokes an
 * active peer. Phase 0 hard-removes the row, which forgets the peer's
 * public key (its future signed requests stop verifying). Phase 1 will
 * also purge any cached `remote_torrents` for this peer before deleting.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const peerId = getRouterParam(event, 'id');
  if (!peerId) throw createError({ statusCode: 400, message: 'Missing peer id' });

  const [peer] = await db
    .select({ id: schema.federationPeers.id })
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.id, peerId))
    .limit(1);
  if (!peer) throw createError({ statusCode: 404, message: 'Peer not found' });

  await db
    .delete(schema.federationPeers)
    .where(eq(schema.federationPeers.id, peerId));

  return { ok: true, removed: peerId };
});
