/**
 * The two passes that a signed record cannot carry.
 *
 * Records are immutable, so anything that changes on its own — swarm counts —
 * has no place inside one: a seeder figure in an immutable artefact would mint
 * a new record every time the swarm breathed. Perishable data therefore
 * travels separately and unsigned, which is honest about what it is: a hint
 * with a short shelf life, not a claim anybody stands behind.
 *
 * Follow notifications live here for a different reason. They are a local
 * reaction to ingestion, not part of it, and keeping them out of the ingestion
 * path is what stops a notification failure from costing a record.
 */
import { eq, and, inArray, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { db, schema } from '@trackarr/db';
import type { FederationPeer } from '@trackarr/db/schema';
import { signedGet } from './signing';
import { notifyMany } from '../notify';


import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from './config';

const PAGE_LIMIT = 100;
const MAX_FOLLOW_NOTIFY = 25; // cap follow notifications per sync run

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}
/** Partner count clamped to PG `integer` range, non-negative. */
function asCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.min(2_147_483_647, Math.max(0, Math.trunc(v)));
}

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

interface NewItem {
  uploaderName: string | null;
  name: string;
  infoHash: string;
}


export async function notifyFollowersOfNewUploads(
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


export async function syncPeerStats(peer: FederationPeer): Promise<number> {
  const config = await getFederationConfig();
  if (!isFederationLive(config)) return 0;
  const privateKeyPem = getPrivateKeyPem(config!);
  const instanceId = config!.instanceId;
  if (!privateKeyPem || !instanceId) return 0;

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
      audienceInstanceId: peer.instanceId ?? undefined,
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
      // UPDATE only, and the count is of rows actually touched. The pass is
      // unsigned, so it must be incapable of creating anything: a count for a
      // release we never mirrored is a no-op, not an insertion — otherwise the
      // one unauthenticated feed left would be a way into the table.
      const touched = await db
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
        )
        .returning({ id: schema.remoteTorrents.id });
      updated += touched.length;
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
