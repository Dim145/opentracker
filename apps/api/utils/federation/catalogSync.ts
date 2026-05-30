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
 * Read-only mirror: nothing here ever touches `torrents` or the local
 * economy. Driven by the `federation-sync` cron plugin.
 */
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '@trackarr/db';
import type { FederationPeer } from '@trackarr/db/schema';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from './config';
import { signedGet } from './signing';

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 25;

interface SyncResult {
  synced: number;
  status: 'ok' | 'error';
  error?: string;
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

  let cursor = state?.cursor ?? null;
  let synced = 0;
  let pages = 0;

  try {
    while (pages < MAX_PAGES_PER_RUN) {
      pages++;
      const qs = new URLSearchParams();
      if (cursor) qs.set('since', cursor);
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
        await upsertRemoteTorrent(peer.id, it as Record<string, unknown>);
        synced++;
      }

      const next = res.data.nextCursor;
      cursor = next ? new Date(next as string).toISOString() : cursor;
      await saveCursor(peer.id, cursor, 'partial', synced, null);
      if (items.length < PAGE_LIMIT) break;
    }

    await saveCursor(peer.id, cursor, 'ok', synced, null);
    await db
      .update(schema.federationPeers)
      .set({ lastSeenAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(schema.federationPeers.id, peer.id));
    return { synced, status: 'ok' };
  } catch (err: unknown) {
    const msg = (err as Error)?.message || 'sync failed';
    await saveCursor(peer.id, cursor, 'error', synced, msg);
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
function asNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

async function upsertRemoteTorrent(
  peerId: string,
  it: Record<string, unknown>,
): Promise<void> {
  const remoteId = asStr(it.remoteId);
  const infoHash = asStr(it.infoHash);
  const name = asStr(it.name);
  if (!remoteId || !infoHash || !name) return; // skip malformed

  const now = new Date();
  const remoteCreatedAt = it.createdAt
    ? new Date(it.createdAt as string)
    : null;
  const shared = {
    infoHash,
    contentSignature: asStr(it.contentSignature),
    name: name.slice(0, 1000),
    size: asNum(it.size),
    description:
      typeof it.description === 'string' ? it.description.slice(0, 20_000) : null,
    categorySlug: asStr(it.categorySlug),
    categoryType: asStr(it.categoryType),
    tags: Array.isArray(it.tags)
      ? (it.tags as unknown[]).filter((t) => typeof t === 'string').slice(0, 50) as string[]
      : null,
    imdbId: asStr(it.imdbId),
    tmdbId: asStr(it.tmdbId),
    tvdbId: asStr(it.tvdbId),
    igdbId: asStr(it.igdbId),
    openlibraryId: asStr(it.openlibraryId),
    seeders: asNum(it.seeders),
    leechers: asNum(it.leechers),
    completed: asNum(it.completed),
    uploaderName: asStr(it.uploaderName),
    remoteCreatedAt:
      remoteCreatedAt && !Number.isNaN(remoteCreatedAt.getTime())
        ? remoteCreatedAt
        : null,
    remoteDetailUrl: asStr(it.detailUrl),
    remoteDownloadUrl: asStr(it.downloadUrl),
    updatedAt: now,
  };

  await db
    .insert(schema.remoteTorrents)
    .values({ id: uuidv4(), peerId, remoteId, fetchedAt: now, ...shared })
    .onConflictDoUpdate({
      target: [schema.remoteTorrents.peerId, schema.remoteTorrents.remoteId],
      set: shared,
    });
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
    // We only pull a catalogue we've agreed to accept from them.
    if (!peer.acceptsFromThem?.catalog) continue;
    const r = await syncPeerCatalogue(peer);
    totalSynced += r.synced;
    count++;
  }
  return { peers: count, synced: totalSynced };
}
