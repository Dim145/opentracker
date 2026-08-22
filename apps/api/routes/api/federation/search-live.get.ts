/**
 * GET /api/federation/search-live?q=<query>  — authenticated, local.
 *
 * The "live" search mode: fan out a signed `GET /api/federation/search` to every
 * active peer that shares its catalogue with us, **write what comes back into
 * the mirror**, then read the answer back out of the mirror.
 *
 * ## Why it writes
 *
 * It used to hold the results in memory and shape its own response. That made
 * it a parallel universe: a second deduplication, a second adult gate, a second
 * idea of what a result is — and a standing question every time a field was
 * added ("does live search carry it too?"). Two implementations of one concept
 * is how they drift.
 *
 * Ingesting through the same `ingestRecord` the cron uses collapses that to one
 * path. The mirror then also warms on exactly what members search for, which is
 * a better cache-fill policy than any cron interval — the periodic sync can
 * afford to be lazier because the hot content arrives on demand.
 *
 * ## Why that is safe
 *
 * A partner answers with signed records, and each one is verified here before
 * it touches the mirror. A peer can decline to answer, answer partially, or
 * replay records it was given by someone else — it cannot answer with a
 * release it did not publish and cannot alter one it did. What survives
 * verification is then scoped per peer, read-only, and never merged into the
 * local catalogue. The fan-out is capped per peer, which caps what one search
 * can insert.
 *
 * Like every federated view, a release links back to its origin instance — we
 * never serve remote `.torrent` bytes with the local passkey.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from '~~/utils/federation/config';
import { signedGet } from '~~/utils/federation/signing';
import {
  announceFresh,
  ingestRecord,
  unwrap,
} from '~~/utils/federation/recordSync';
import { browseMirror } from '~~/utils/federation/browseMirror';
import { relayEnabled, trustedIssuers } from '~~/utils/federation/relay';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireAuthSession } from '~~/utils/adminAuth';

const PER_PEER_TIMEOUT_MS = 6000;
const PER_PEER_LIMIT = 30;

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { showAdultContent: true },
  });
  const showAdult = me?.showAdultContent ?? false;

  const q = getQuery(event);
  const search = typeof q.q === 'string' ? q.q.trim() : '';
  if (search.length < 2) {
    throw createError({ statusCode: 400, message: 'query too short' });
  }
  const limit = Math.min(100, Math.max(1, parseInt(String(q.limit ?? '50'), 10) || 50));
  const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1);

  const empty = { items: [], pagination: { page, limit, total: 0, pages: 1 }, peers: 0, mode: 'live' as const };

  const config = await getFederationConfig();
  if (!isFederationLive(config)) return empty;
  const pk = getPrivateKeyPem(config!);
  if (!pk || !config!.instanceId) return empty;
  const instanceId = config!.instanceId;

  const peers = (
    await db
      .select()
      .from(schema.federationPeers)
      .where(eq(schema.federationPeers.status, 'active'))
  ).filter((p) => p.acceptsFromThem?.catalog);
  if (!peers.length) return empty;

  const qs = new URLSearchParams({ q: search, limit: String(PER_PEER_LIMIT) });
  const settled = await Promise.allSettled(
    peers.map((peer) =>
      signedGet({
        baseUrl: peer.baseUrl,
        pathname: `/api/federation/search?${qs.toString()}`,
        instanceId,
        privateKeyPem: pk,
        timeoutMs: PER_PEER_TIMEOUT_MS,
        audienceInstanceId: peer.instanceId ?? undefined,
      }).then((res) => ({ peer, res })),
    ),
  );

  // Ingest. A peer that times out, errors or answers garbage is skipped — the
  // search still returns whatever the others said, and whatever the mirror
  // already held for them.
  // Both read once for the whole fan-out. Asked per record they were two
  // queries each, thirty records a partner, on every search anybody runs.
  const trusted = await trustedIssuers();
  const relaying = await relayEnabled();

  const reachedIds: string[] = [];
  let rejected = 0;
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    const { peer, res } = s.value;
    if (res.status !== 200 || !Array.isArray(res.data?.records)) continue;
    reachedIds.push(peer.id);
    const fresh: NonNullable<Awaited<ReturnType<typeof ingestRecord>>['fresh']>[] = [];
    for (const item of res.data.records as unknown[]) {
      try {
        const { record, relay } = unwrap(item);
        const r = await ingestRecord(peer, record, {
          relayProof: relay,
          trusted,
          relaying,
        });
        rejected += r.rejected;
        if (r.fresh) fresh.push(r.fresh);
      } catch {
        // One bad record must not lose the rest of the page.
        rejected++;
      }
    }
    // A search can surface a release before the cron reaches it, so a follower
    // should hear about it now rather than on the next tick.
    await announceFresh(peer, fresh);
  }
  if (rejected) {
    console.warn(
      `[Federation Search] ${rejected} record(s) failed verification`,
    );
  }
  if (!reachedIds.length) return empty;

  const result = await browseMirror({
    search,
    page,
    limit,
    showAdult,
    // Only the partners that answered: otherwise a "live" result would quietly
    // include stale cron rows from peers that were down.
    peerIds: reachedIds,
  });

  return { ...result, peers: reachedIds.length, mode: 'live' as const };
});
