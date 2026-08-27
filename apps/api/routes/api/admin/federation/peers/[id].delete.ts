/**
 * DELETE /api/admin/federation/peers/:id
 *
 * Owner tears a link down — rejects a pending request OR revokes an
 * active peer. Phase 0 hard-removes the row, which forgets the peer's
 * public key (its future signed requests stop verifying), the cascade drops
 * its mirror rows and sources, and the sweep below purges any ingested record
 * left with no source.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { purgeOrphanedIngested } from '~~/utils/federation/relay';
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

  // The cascade removed this peer's mirror rows, sources and alias links. It
  // did NOT remove the ingested `catalog_records` those sources pointed at —
  // there is no FK — so without this sweep we would keep, and keep relaying, an
  // ex-partner's whole catalogue. This is the missing half of tearing a link
  // down that the schema always promised.
  const purged = await purgeOrphanedIngested();

  return { ok: true, removed: peerId, recordsPurged: purged };
});
