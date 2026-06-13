/**
 * Catalogue sync — pulls partner catalogues into `remote_torrents`.
 *
 * For each active peer that shares `catalog` with us, walk
 * GET /api/federation/catalog forward from our saved cursor, upserting
 * every item. The cursor (peer's `created_at` watermark) is persisted in
 * `federation_sync_state` so each run only fetches what's new. Bounded by
 * MAX_PAGES_PER_RUN so a huge backlog is drained over several ticks rather
 * than pinning one.
 *
 * Phase 2a: NEW items (first-seen this sync) from an uploader a local user
 * follows (`federated_follows`) emit a `federated_followed_upload` notice —
 * a pull-based "follow" with no S2S Follow protocol (latency = sync period).
 *
 * Read-only mirror: nothing here ever touches `torrents` or the local
 * economy. Driven by the `federation-sync` cron plugin.
 */
import { eq, and, inArray, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { db, schema } from '@trackarr/db';
import type { FederationPeer } from '@trackarr/db/schema';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from './config';
import { signedGet } from './signing';
import { notifyMany } from '../notify';

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 25;
const MAX_REMOTE_PER_PEER = 100_000; // hard cap on mirrored rows per peer
const MAX_FOLLOW_NOTIFY = 25; // cap follow notifications per sync run

interface CatCursor {
  t: string;
  id: string | null;
}
/** Parse the stored cursor: composite JSON `{t,id}` or a legacy ISO string. */
function parseCatalogCursor(stored: string | null): CatCursor | null {
  if (!stored) return null;
  try {
    const o = JSON.parse(stored);
    if (o && typeof o.t === 'string') {
      return { t: o.t, id: typeof o.id === 'string' ? o.id : null };
    }
  } catch {
    /* legacy ISO string */
  }
  return { t: stored, id: null };
}
/** Read a partner's nextCursor: composite `{createdAt,id}` (new) or legacy ISO
 *  string. Returns null on anything malformed — never throws (a bad date used
 *  to abort the whole peer sync). */
function readNextCursor(next: unknown): CatCursor | null {
  let t: string | null = null;
  let id: string | null = null;
  if (next && typeof next === 'object') {
    const o = next as Record<string, unknown>;
    // `t` is the removals/stats feeds' field; `createdAt` the catalogue's.
    if (typeof o.t === 'string') t = o.t;
    else if (typeof o.createdAt === 'string') t = o.createdAt;
    if (typeof o.id === 'string') id = o.id;
  } else if (typeof next === 'string') {
    t = next;
  }
  if (!t) return null;
  // Validate it parses but KEEP the original string — `toISOString()` truncates
  // to milliseconds, which would re-introduce the boundary re-fetch bug
  // (catalog.get now emits and compares a µs-precision cursor).
  if (Number.isNaN(new Date(t).getTime())) return null;
  return { t, id };
}

interface SyncResult {
  synced: number;
  status: 'ok' | 'error';
  error?: string;
}

/** A torrent seen for the first time this sync — candidate for a follow ping. */
interface NewItem {
  uploaderName: string | null;
  name: string;
  infoHash: string;
}

export async function syncPeerCatalogue(peer: FederationPeer): Promise<SyncResult> {
  const config = await getFederationConfig();
  if (!isFederationLive(config)) {
    return { synced: 0, status: 'error', error: 'federation not live' };
  }
  const privateKeyPem = getPrivateKeyPem(config!);
  if (!privateKeyPem || !config!.instanceId) {
    return { synced: 0, status: 'error', error: 'no identity' };
  }

  const [state] = await db
    .select()
    .from(schema.federationSyncState)
    .where(
      and(
        eq(schema.federationSyncState.peerId, peer.id),
        eq(schema.federationSyncState.resource, 'catalog'),
      ),
    )
    .limit(1);

  const cur = parseCatalogCursor(state?.cursor ?? null);
  const isFirstSync = !state; // initial backfill — do NOT notify followers
  let nextStored = state?.cursor ?? null;
  let sinceT = cur?.t ?? null;
  let sinceId = cur?.id ?? null;
  let synced = 0;
  let pages = 0;
  const newItems: NewItem[] = [];

  // Cap the mirror per peer so a misbehaving partner can't grow the table
  // without bound.
  const [{ existing }] = await db
    .select({ existing: sql<number>`count(*)::int` })
    .from(schema.remoteTorrents)
    .where(eq(schema.remoteTorrents.peerId, peer.id));
  if ((existing ?? 0) >= MAX_REMOTE_PER_PEER) {
    await saveCursor(peer.id, nextStored, 'ok', 0, 'row cap reached');
    return { synced: 0, status: 'ok' };
  }

  try {
    while (pages < MAX_PAGES_PER_RUN) {
      pages++;
      const qs = new URLSearchParams();
      if (sinceT) qs.set('since', sinceT);
      if (sinceT && sinceId) qs.set('sinceId', sinceId);
      qs.set('limit', String(PAGE_LIMIT));
      const pathname = `/api/federation/catalog?${qs.toString()}`;

      const res = await signedGet({
        baseUrl: peer.baseUrl,
        pathname,
        instanceId: config!.instanceId,
        privateKeyPem,
      });
      if (res.status !== 200 || !res.data?.ok || !Array.isArray(res.data.items)) {
        throw new Error(res.data?.message || `HTTP ${res.status}`);
      }

      const items = res.data.items as unknown[];
      if (items.length === 0) break;
      for (const it of items) {
        const r = await upsertRemoteTorrent(peer.id, it as Record<string, unknown>);
        if (!r) continue;
        synced++;
        if (r.isNew && r.uploaderName) newItems.push(r);
      }

      // Advance the composite (created_at,id) cursor. readNextCursor tolerates
      // a legacy string and never throws on a malformed value.
      const adv = readNextCursor(res.data.nextCursor);
      if (adv) {
        sinceT = adv.t;
        sinceId = adv.id;
        nextStored = JSON.stringify({ t: adv.t, id: adv.id });
      }
      await saveCursor(peer.id, nextStored, 'partial', synced, null);
      if (items.length < PAGE_LIMIT) break;
    }

    await saveCursor(peer.id, nextStored, 'ok', synced, null);
    await db
      .update(schema.federationPeers)
      .set({ lastSeenAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(schema.federationPeers.id, peer.id));

    // Phase 2a — ping local followers of any uploader who just shipped. Skip
    // on the very first sync of a peer (the initial backfill would otherwise
    // notify the whole back-catalogue at once).
    if (newItems.length && !isFirstSync) {
      await notifyFollowersOfNewUploads(peer, newItems);
    }
    return { synced, status: 'ok' };
  } catch (err: unknown) {
    const msg = (err as Error)?.message || 'sync failed';
    await saveCursor(peer.id, nextStored, 'error', synced, msg);
    await db
      .update(schema.federationPeers)
      .set({ lastError: `Catalogue sync: ${msg}`, updatedAt: new Date() })
      .where(eq(schema.federationPeers.id, peer.id));
    return { synced, status: 'error', error: msg };
  }
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}
/** Partner count clamped to PG `integer` range, non-negative. */
function asCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.min(2_147_483_647, Math.max(0, Math.trunc(v)));
}
/** Partner size clamped to a safe non-negative ceiling (avoids bigint overflow). */
function asSize(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(v)));
}
/** Only an absolute http(s) URL survives — no javascript:/data: into the UI's :href. */
function asHttpUrl(v: unknown): string | null {
  const s = asStr(v);
  return s && /^https?:\/\//i.test(s) ? s : null;
}

async function upsertRemoteTorrent(
  peerId: string,
  it: Record<string, unknown>,
): Promise<NewItem & { isNew: boolean } | null> {
  const remoteId = asStr(it.remoteId);
  const infoHash = asStr(it.infoHash);
  const name = asStr(it.name);
  if (!remoteId || !infoHash || !name) return null; // skip malformed

  const now = new Date();
  const remoteCreatedAt = it.createdAt
    ? new Date(it.createdAt as string)
    : null;
  const uploaderName = asStr(it.uploaderName);
  const shared = {
    infoHash,
    contentSignature: asStr(it.contentSignature),
    name: name.slice(0, 1000),
    size: asSize(it.size),
    description:
      typeof it.description === 'string' ? it.description.slice(0, 20_000) : null,
    categorySlug: asStr(it.categorySlug),
    categoryType: asStr(it.categoryType),
    isAdult: it.isAdult === true,
    tags: Array.isArray(it.tags)
      ? ((it.tags as unknown[]).filter((t) => typeof t === 'string').slice(0, 50) as string[])
      : null,
    imdbId: asStr(it.imdbId),
    tmdbId: asStr(it.tmdbId),
    tvdbId: asStr(it.tvdbId),
    igdbId: asStr(it.igdbId),
    openlibraryId: asStr(it.openlibraryId),
    seeders: asCount(it.seeders),
    leechers: asCount(it.leechers),
    completed: asCount(it.completed),
    uploaderName,
    remoteCreatedAt:
      remoteCreatedAt && !Number.isNaN(remoteCreatedAt.getTime())
        ? remoteCreatedAt
        : null,
    remoteDetailUrl: asHttpUrl(it.detailUrl),
    remoteDownloadUrl: asHttpUrl(it.downloadUrl),
    updatedAt: now,
  };

  // `xmax = 0` is true only for a fresh INSERT (not an ON CONFLICT update),
  // letting us distinguish first-seen torrents from refreshed ones.
  const [row] = await db
    .insert(schema.remoteTorrents)
    .values({ id: uuid(), peerId, remoteId, fetchedAt: now, ...shared })
    .onConflictDoUpdate({
      target: [schema.remoteTorrents.peerId, schema.remoteTorrents.remoteId],
      set: shared,
    })
    .returning({ isNew: sql<boolean>`(xmax = 0)` });

  return { isNew: !!row?.isNew, uploaderName, name: shared.name, infoHash };
}

/** Notify local followers when a followed remote uploader ships something new. */
async function notifyFollowersOfNewUploads(
  peer: FederationPeer,
  newItems: NewItem[],
): Promise<void> {
  // Cap pings per run so a partner flooding fabricated uploads can't fan out
  // an unbounded notification/email storm.
  if (newItems.length > MAX_FOLLOW_NOTIFY) {
    newItems = newItems.slice(0, MAX_FOLLOW_NOTIFY);
  }
  const uploaders = [
    ...new Set(newItems.map((i) => i.uploaderName).filter((u): u is string => !!u)),
  ];
  if (!uploaders.length) return;

  const follows = await db
    .select({
      localUserId: schema.federatedFollows.localUserId,
      remoteUsername: schema.federatedFollows.remoteUsername,
    })
    .from(schema.federatedFollows)
    .where(
      and(
        eq(schema.federatedFollows.peerId, peer.id),
        inArray(schema.federatedFollows.remoteUsername, uploaders),
      ),
    );
  if (!follows.length) return;

  const followersByUploader = new Map<string, string[]>();
  for (const f of follows) {
    const list = followersByUploader.get(f.remoteUsername) ?? [];
    list.push(f.localUserId);
    followersByUploader.set(f.remoteUsername, list);
  }

  const peerName = peer.displayName || peer.baseUrl;
  for (const item of newItems) {
    const followers = item.uploaderName
      ? followersByUploader.get(item.uploaderName)
      : undefined;
    if (!followers || !followers.length) continue;
    await notifyMany(
      followers,
      'federated_followed_upload',
      {
        uploaderName: item.uploaderName,
        peerName,
        torrentName: item.name,
        infoHash: item.infoHash,
      },
      '/federated',
    );
  }
}

async function saveCursor(
  peerId: string,
  cursor: string | null,
  status: string,
  items: number,
  error: string | null,
  resource = 'catalog',
): Promise<void> {
  const row = {
    cursor,
    lastRunAt: new Date(),
    lastStatus: status,
    itemsSynced: items,
    lastError: error,
  };
  await db
    .insert(schema.federationSyncState)
    .values({ peerId, resource, ...row })
    .onConflictDoUpdate({
      target: [
        schema.federationSyncState.peerId,
        schema.federationSyncState.resource,
      ],
      set: row,
    });
}

/** Read the stored composite cursor for one peer + resource. */
async function readCursor(
  peerId: string,
  resource: string,
): Promise<CatCursor | null> {
  const [state] = await db
    .select()
    .from(schema.federationSyncState)
    .where(
      and(
        eq(schema.federationSyncState.peerId, peerId),
        eq(schema.federationSyncState.resource, resource),
      ),
    )
    .limit(1);
  return parseCatalogCursor(state?.cursor ?? null);
}

/**
 * Pull a peer's tombstones (`/api/federation/catalog-removals`) and delete the
 * matching mirror rows. Closes the append-forward sync's blind spot for
 * deletes / moderation pulls / uploader bans. Best-effort: errors are recorded
 * on the cursor row, never thrown.
 */
async function syncPeerRemovals(
  peer: FederationPeer,
  instanceId: string,
  privateKeyPem: string,
): Promise<number> {
  const cur = await readCursor(peer.id, 'catalog_removals');
  let sinceT = cur?.t ?? null;
  let sinceId = cur?.id ?? null;
  let nextStored = cur ? JSON.stringify({ t: cur.t, id: cur.id }) : null;
  let removed = 0;
  let pages = 0;
  try {
    while (pages < MAX_PAGES_PER_RUN) {
      pages++;
      const qs = new URLSearchParams();
      if (sinceT) qs.set('since', sinceT);
      if (sinceT && sinceId) qs.set('sinceId', sinceId);
      qs.set('limit', String(PAGE_LIMIT));
      const res = await signedGet({
        baseUrl: peer.baseUrl,
        pathname: `/api/federation/catalog-removals?${qs.toString()}`,
        instanceId,
        privateKeyPem,
      });
      if (res.status !== 200 || !res.data?.ok || !Array.isArray(res.data.items)) {
        throw new Error(res.data?.message || `HTTP ${res.status}`);
      }
      const items = res.data.items as Array<{ remoteId?: string }>;
      if (items.length === 0) break;
      const remoteIds = items
        .map((i) => i.remoteId)
        .filter((x): x is string => typeof x === 'string' && !!x);
      if (remoteIds.length) {
        await db
          .delete(schema.remoteTorrents)
          .where(
            and(
              eq(schema.remoteTorrents.peerId, peer.id),
              inArray(schema.remoteTorrents.remoteId, remoteIds),
            ),
          );
        removed += remoteIds.length;
      }
      const adv = readNextCursor(res.data.nextCursor);
      if (adv) {
        sinceT = adv.t;
        sinceId = adv.id;
        nextStored = JSON.stringify({ t: adv.t, id: adv.id });
      }
      await saveCursor(peer.id, nextStored, 'partial', removed, null, 'catalog_removals');
      if (items.length < PAGE_LIMIT) break;
    }
    await saveCursor(peer.id, nextStored, 'ok', removed, null, 'catalog_removals');
  } catch (err) {
    await saveCursor(
      peer.id,
      nextStored,
      'error',
      removed,
      (err as Error)?.message ?? 'removals sync failed',
      'catalog_removals',
    );
  }
  return removed;
}

/**
 * Refresh swarm counts on already-mirrored rows from a peer's
 * `/api/federation/catalog-stats` feed. One bounded page per tick (stats churn
 * constantly; the cursor walks updated_at so the freshest changes land first).
 */
async function syncPeerStats(
  peer: FederationPeer,
  instanceId: string,
  privateKeyPem: string,
): Promise<number> {
  const cur = await readCursor(peer.id, 'catalog_stats');
  let sinceT = cur?.t ?? null;
  let sinceId = cur?.id ?? null;
  let nextStored = cur ? JSON.stringify({ t: cur.t, id: cur.id }) : null;
  let updated = 0;
  try {
    const qs = new URLSearchParams();
    if (sinceT) qs.set('since', sinceT);
    if (sinceT && sinceId) qs.set('sinceId', sinceId);
    qs.set('limit', String(PAGE_LIMIT));
    const res = await signedGet({
      baseUrl: peer.baseUrl,
      pathname: `/api/federation/catalog-stats?${qs.toString()}`,
      instanceId,
      privateKeyPem,
    });
    if (res.status !== 200 || !res.data?.ok || !Array.isArray(res.data.items)) {
      throw new Error(res.data?.message || `HTTP ${res.status}`);
    }
    const items = res.data.items as Array<{
      infoHash?: string;
      seeders?: number;
      leechers?: number;
      completed?: number;
    }>;
    for (const it of items) {
      const infoHash = asStr(it.infoHash);
      if (!infoHash) continue;
      await db
        .update(schema.remoteTorrents)
        .set({
          seeders: asCount(it.seeders),
          leechers: asCount(it.leechers),
          completed: asCount(it.completed),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.remoteTorrents.peerId, peer.id),
            eq(schema.remoteTorrents.infoHash, infoHash),
          ),
        );
      updated++;
    }
    const adv = readNextCursor(res.data.nextCursor);
    if (adv) {
      sinceT = adv.t;
      sinceId = adv.id;
      nextStored = JSON.stringify({ t: adv.t, id: adv.id });
    }
    await saveCursor(peer.id, nextStored, 'ok', updated, null, 'catalog_stats');
  } catch (err) {
    await saveCursor(
      peer.id,
      nextStored,
      'error',
      updated,
      (err as Error)?.message ?? 'stats sync failed',
      'catalog_stats',
    );
  }
  return updated;
}

/**
 * Pull a peer's CHANGED rows (`/api/federation/catalog-refresh`) and upsert
 * them — re-mirroring metadata edits, re-approvals, and un-bans that the
 * append-forward catalogue cursor can't see. No follower notify (a refresh is
 * not a new upload).
 */
async function syncPeerRefresh(
  peer: FederationPeer,
  instanceId: string,
  privateKeyPem: string,
): Promise<number> {
  const cur = await readCursor(peer.id, 'catalog_refresh');
  let sinceT = cur?.t ?? null;
  let sinceId = cur?.id ?? null;
  let nextStored = cur ? JSON.stringify({ t: cur.t, id: cur.id }) : null;
  let refreshed = 0;
  let pages = 0;
  try {
    while (pages < MAX_PAGES_PER_RUN) {
      pages++;
      const qs = new URLSearchParams();
      if (sinceT) qs.set('since', sinceT);
      if (sinceT && sinceId) qs.set('sinceId', sinceId);
      qs.set('limit', String(PAGE_LIMIT));
      const res = await signedGet({
        baseUrl: peer.baseUrl,
        pathname: `/api/federation/catalog-refresh?${qs.toString()}`,
        instanceId,
        privateKeyPem,
      });
      if (res.status !== 200 || !res.data?.ok || !Array.isArray(res.data.items)) {
        throw new Error(res.data?.message || `HTTP ${res.status}`);
      }
      const items = res.data.items as unknown[];
      if (items.length === 0) break;
      for (const it of items) {
        const r = await upsertRemoteTorrent(peer.id, it as Record<string, unknown>);
        if (r) refreshed++;
      }
      const adv = readNextCursor(res.data.nextCursor);
      if (adv) {
        sinceT = adv.t;
        sinceId = adv.id;
        nextStored = JSON.stringify({ t: adv.t, id: adv.id });
      }
      await saveCursor(peer.id, nextStored, 'partial', refreshed, null, 'catalog_refresh');
      if (items.length < PAGE_LIMIT) break;
    }
    await saveCursor(peer.id, nextStored, 'ok', refreshed, null, 'catalog_refresh');
  } catch (err) {
    await saveCursor(
      peer.id,
      nextStored,
      'error',
      refreshed,
      (err as Error)?.message ?? 'refresh sync failed',
      'catalog_refresh',
    );
  }
  return refreshed;
}

/** Sync every active peer that shares its catalogue with us. */
export async function syncAllCatalogues(): Promise<{
  peers: number;
  synced: number;
  removed: number;
}> {
  const peers = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.status, 'active'));

  // Shared signing context for the removals + stats passes (the catalogue pass
  // resolves its own inside syncPeerCatalogue).
  const config = await getFederationConfig();
  const live = isFederationLive(config);
  const pk = live ? getPrivateKeyPem(config!) : null;
  const instanceId = config?.instanceId ?? null;

  let totalSynced = 0;
  let totalRemoved = 0;
  let count = 0;
  for (const peer of peers) {
    if (!peer.acceptsFromThem?.catalog) continue;
    const r = await syncPeerCatalogue(peer);
    totalSynced += r.synced;
    count++;
    // Additive passes: tombstone-driven deletes + swarm-count refresh. They
    // close the append-forward sync's blind spots (deletes/bans, stale stats)
    // without touching the catalogue cursor. Skipped if we can't sign.
    if (pk && instanceId) {
      totalRemoved += await syncPeerRemovals(peer, instanceId, pk);
      await syncPeerRefresh(peer, instanceId, pk);
      await syncPeerStats(peer, instanceId, pk);
    }
  }
  return { peers: count, synced: totalSynced, removed: totalRemoved };
}
