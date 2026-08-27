/**
 * POST /api/admin/federation/peers/:id/recover — owner recovery tooling.
 *
 * Until now the only lever an operator had over a misbehaving link was
 * suspend/block/delete the whole peer, and the only way to fix a corrupted
 * mirror was `psql`. These are the three repairs short of tearing the link
 * down, chosen by `mode`:
 *
 *   - `repair`  — re-run the mirror-drift repair (forget any source whose
 *                 mirror row went missing, so the next reconcile re-fetches
 *                 it). Cheap, safe, non-destructive.
 *   - `resync`  — additionally run a reconciliation now instead of waiting for
 *                 the next tick.
 *   - `refetch` — forget everything cached from this peer (mirror, sources,
 *                 alias links) and reconcile from scratch. Destructive of the
 *                 cache only; the link and the peer's key stay. The whole
 *                 catalogue is pulled again over the following ticks.
 *
 * None of these touch what WE published or any other peer's data.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { forgetPeerData, repairMissingMirrors } from '~~/utils/federation/relay';
import { syncPeerRecords } from '~~/utils/federation/recordSync';

const bodySchema = z.object({
  mode: z.enum(['repair', 'resync', 'refetch']).default('repair'),
});

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const peerId = getRouterParam(event, 'id');
  if (!peerId) throw createError({ statusCode: 400, message: 'Missing peer id' });
  const { mode } = await validateBody(event, bodySchema);

  const [peer] = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.id, peerId))
    .limit(1);
  if (!peer) throw createError({ statusCode: 404, message: 'Peer not found' });
  if (peer.status !== 'active') {
    throw createError({
      statusCode: 409,
      message: 'Only an active peer can be recovered — reactivate it first',
    });
  }

  if (mode === 'refetch') {
    // Forget the cache but keep the key: the next reconcile sees the whole of
    // the partner's catalogue as missing and pulls it again.
    await forgetPeerData(peerId);
    // Clear the sync-state so the health page does not carry a stale verdict
    // into the fresh pull.
    await db
      .delete(schema.federationSyncState)
      .where(eq(schema.federationSyncState.peerId, peerId));
  } else {
    await repairMissingMirrors(peerId);
  }

  // `resync` and `refetch` both kick a reconciliation now; `repair` leaves the
  // next scheduled tick to pick the drift up.
  const result =
    mode === 'repair' ? null : await syncPeerRecords(peer);

  return { ok: true, mode, result };
});
