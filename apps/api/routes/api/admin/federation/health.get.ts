/**
 * GET /api/admin/federation/health
 *
 * Answers the only question an operator really asks: "is my federation
 * healthy?"
 *
 * The data already existed — `federation_sync_state` has always recorded the
 * last run, the cursor, the item count and any error per (peer, resource) pair
 * — but nothing read it back. A peer failing silently for days stayed invisible
 * until somebody went and read the table by hand.
 *
 * The verdict is computed here rather than in the UI: "behind" only means
 * anything relative to the actual sync interval, which the server knows and the
 * browser would otherwise have to guess.
 */
import { db, schema } from '@trackarr/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { requireAdminSession } from '~~/utils/adminAuth';
import { getFederationConfig, syncIntervalMs } from '~~/utils/federation/config';
import { recordStore, sourcedByPeer } from '~~/utils/federation/storeCounts';

/** A peer is "behind" past three intervals with no run. */
const STALE_INTERVALS = 3;

type Verdict = 'ok' | 'stale' | 'degraded' | 'error' | 'never';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const config = await getFederationConfig();
  const intervalMs = syncIntervalMs();
  const staleAfterMs = intervalMs * STALE_INTERVALS;
  const now = Date.now();

  // Only active peers count: a pending or blocked peer is not supposed to
  // sync, so showing it as failing would be a false positive.
  const peers = await db
    .select({
      id: schema.federationPeers.id,
      displayName: schema.federationPeers.displayName,
      baseUrl: schema.federationPeers.baseUrl,
      status: schema.federationPeers.status,
      lastSeenAt: schema.federationPeers.lastSeenAt,
      lastHandshakeAt: schema.federationPeers.lastHandshakeAt,
      lastError: schema.federationPeers.lastError,
    })
    .from(schema.federationPeers)
    .orderBy(desc(schema.federationPeers.lastSeenAt));

  const peerIds = peers.map((p) => p.id);

  // One round trip per table rather than one per peer: the peer count is
  // small but the page auto-refreshes, and an N+1 on an automatic refresh is
  // paid for every single day.
  const [states, mirrorCounts, sourced, records] = await Promise.all([
    peerIds.length
      ? db
          .select()
          .from(schema.federationSyncState)
          .where(inArray(schema.federationSyncState.peerId, peerIds))
      : [],
    peerIds.length
      ? db
          .select({
            peerId: schema.remoteTorrents.peerId,
            count: sql<number>`count(*)::int`,
          })
          .from(schema.remoteTorrents)
          .where(inArray(schema.remoteTorrents.peerId, peerIds))
          .groupBy(schema.remoteTorrents.peerId)
      : [],
    // Both counts live in `storeCounts.ts`, where a real database can be
    // pointed at them: an aggregate behind an admin session on a page that
    // refreshes itself either shows a wrong number for months or throws where
    // nobody is looking, and neither failure announces itself.
    sourcedByPeer(peerIds),
    recordStore(),
  ]);

  // `as const` keeps each entry a 2-tuple. Without it `.map` widens to
  // `(string | number)[]`, `new Map` finds no matching overload, and the map's
  // values degrade to `unknown` — which is what made `n + r.mirrored` below
  // fail to typecheck.
  const mirrorByPeer = new Map(
    mirrorCounts.map((r) => [r.peerId, r.count] as const)
  );
  const statesByPeer = new Map<string, typeof states>();
  for (const s of states) {
    const list = statesByPeer.get(s.peerId) ?? [];
    list.push(s);
    statesByPeer.set(s.peerId, list);
  }

  const verdictFor = (
    lastRunAt: Date | null,
    lastStatus: string | null
  ): Verdict => {
    if (lastStatus === 'error') return 'error';
    // `partial` means the run completed but something inside it did not — some
    // records failed verification, or the mirror hit its row cap and stopped
    // fetching. It used to fall through to `ok`, painting a peer that has
    // partly stopped working green. It is a degraded peer, and says so.
    if (lastStatus === 'partial') return 'degraded';
    if (!lastRunAt) return 'never';
    return now - lastRunAt.getTime() > staleAfterMs ? 'stale' : 'ok';
  };

  const rows = peers.map((peer) => {
    const resources = (statesByPeer.get(peer.id) ?? []).map((s) => ({
      resource: s.resource,
      cursor: s.cursor,
      lastRunAt: s.lastRunAt,
      lastStatus: s.lastStatus,
      itemsSynced: s.itemsSynced,
      lastError: s.lastError,
      verdict: verdictFor(s.lastRunAt, s.lastStatus),
    }));

    // The peer's verdict: the worst of its resources. A catalogue succeeding
    // while removals fail is not a healthy peer.
    const order: Verdict[] = ['ok', 'stale', 'degraded', 'never', 'error'];
    const worst = resources.reduce<Verdict>(
      (acc, r) => (order.indexOf(r.verdict) > order.indexOf(acc) ? r.verdict : acc),
      resources.length ? 'ok' : 'never'
    );

    return {
      ...peer,
      active: peer.status === 'active',
      mirrored: mirrorByPeer.get(peer.id) ?? 0,
      sourced: sourced.get(peer.id) ?? 0,
      resources,
      verdict: peer.status === 'active' ? worst : null,
    };
  });

  const active = rows.filter((r) => r.active);
  const summary = {
    peersTotal: rows.length,
    peersActive: active.length,
    ok: active.filter((r) => r.verdict === 'ok').length,
    stale: active.filter((r) => r.verdict === 'stale').length,
    degraded: active.filter((r) => r.verdict === 'degraded').length,
    error: active.filter((r) => r.verdict === 'error').length,
    never: active.filter((r) => r.verdict === 'never').length,
    mirroredTotal: rows.reduce((n, r) => n + r.mirrored, 0),
    records,
    // Last run across all resources: federation's "heartbeat", and the first
    // thing anyone looks at.
    lastRunAt:
      states
        .map((s) => s.lastRunAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
  };

  return {
    enabled: !!config?.enabled,
    intervalMs,
    staleAfterMs,
    summary,
    peers: rows,
  };
});
