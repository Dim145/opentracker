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
    if (typeof o.createdAt === 'string') t = o.createdAt;
    if (typeof o.id === 'string') id = o.id;
  } else if (typeof next === 'string') {
    t = next;
  }
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return { t: d.toISOString(), id };
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
    .values({ peerId, resource: 'catalog', ...row })
    .onConflictDoUpdate({
      target: [
        schema.federationSyncState.peerId,
        schema.federationSyncState.resource,
      ],
      set: row,
    });
}

/** Sync every active peer that shares its catalogue with us. */
export async function syncAllCatalogues(): Promise<{
  peers: number;
  synced: number;
}> {
  const peers = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.status, 'active'));

  let totalSynced = 0;
  let count = 0;
  for (const peer of peers) {
    if (!peer.acceptsFromThem?.catalog) continue;
    const r = await syncPeerCatalogue(peer);
    totalSynced += r.synced;
    count++;
  }
  return { peers: count, synced: totalSynced };
}
