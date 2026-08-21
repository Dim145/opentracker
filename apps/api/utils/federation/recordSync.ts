/**
 * Ingesting signed records from a partner.
 *
 * This is the half of the change that matters. Minting and serving made
 * records exist; accepting them **on their proof rather than on their channel**
 * is what changes the architecture.
 *
 * The old path trusted the connection: a row was mirrored because a peer we
 * had approved sent it over a signed request. That is a statement about the
 * transport, so a record could never be relayed — B saying "C published this"
 * was unverifiable, and every instance therefore had to fetch from every other
 * instance itself. Here every record is checked against its own proof, which
 * means:
 *
 * - **The route stops mattering.** A record that verifies is as good from a
 *   relay as from its author, which is the precondition for gossip and for the
 *   O(N) topology that replaces the current O(N²) mesh.
 * - **The peer stops being trusted.** It can withhold records, replay old
 *   ones, or send nothing at all. It cannot forge one, and it cannot alter one
 *   in flight — both are caught here, counted, and left in the sync state
 *   where an operator can see them.
 * - **Ingestion becomes idempotent across relays.** The content address is the
 *   identity, so the same statement offered by three partners is recognised as
 *   one statement.
 *
 * ## What is still per-peer
 *
 * Where to *get* the release. A record says who published it and — through its
 * `url` — where it lives, but the peer that handed it over is also somewhere it
 * can be fetched. The mirror therefore keeps a row per peer, identified by the
 * record: same statement, several places to act on it.
 */
import { and, eq, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { db, schema } from '@trackarr/db';
import type { FederationPeer } from '@trackarr/db/schema';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from './config';
import { parseReleaseName } from '@trackarr/shared/releaseParse';
import { signedGet } from './signing';
import { verifyRecord } from './record';
import { notifyFollowersOfNewUploads } from './sidePasses';

const PAGE_LIMIT = 200;
/** Pages per run. Bounded so one partner cannot monopolise a sync cycle. */
const MAX_PAGES = 25;
/**
 * Hard cap on mirrored rows per partner.
 *
 * Signatures do not make this unnecessary. A proof says a partner really did
 * publish a release; it says nothing about how many it is entitled to publish,
 * and minting a million valid records is no harder than minting one. The cap
 * is the only thing standing between an over-enthusiastic — or hostile —
 * partner and our disk.
 */
const MAX_REMOTE_PER_PEER = 100_000;
const RESOURCE = 'records';

interface NewItem {
  uploaderName: string | null;
  name: string;
  infoHash: string;
}

export interface RecordSyncResult {
  ingested: number;
  withdrawn: number;
  /** Records whose proof did not hold. The number an operator should watch. */
  rejected: number;
  pages: number;
  error?: string;
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}
function asNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0;
}
function asPosition(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return null;
  return v >= 0 && v <= 9_999 ? v : null;
}
/** Only an absolute http(s) URL survives — never a `javascript:` into a href. */
function asHttpUrl(v: unknown): string | null {
  const s = asStr(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? s : null;
  } catch {
    return null;
  }
}

async function readCursor(peerId: string): Promise<number | null> {
  const [state] = await db
    .select({ cursor: schema.federationSyncState.cursor })
    .from(schema.federationSyncState)
    .where(
      and(
        eq(schema.federationSyncState.peerId, peerId),
        eq(schema.federationSyncState.resource, RESOURCE),
      ),
    )
    .limit(1);
  // `null` — never synced — is not the same as `0`. Only the first tells us
  // this is an initial backfill, which must not notify followers about a
  // partner's entire back catalogue at once.
  if (!state) return null;
  const n = parseInt(state.cursor ?? '0', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function saveCursor(
  peerId: string,
  cursor: number,
  status: string,
  items: number,
  error: string | null,
): Promise<void> {
  const row = {
    cursor: String(cursor),
    lastRunAt: new Date(),
    lastStatus: status,
    itemsSynced: items,
    lastError: error,
  };
  await db
    .insert(schema.federationSyncState)
    .values({ peerId, resource: RESOURCE, ...row })
    .onConflictDoUpdate({
      target: [
        schema.federationSyncState.peerId,
        schema.federationSyncState.resource,
      ],
      set: row,
    });
}

/**
 * Turn a verified record into a mirror row.
 *
 * Every value is re-coerced even though the record's proof held. A valid
 * signature proves the issuer wrote these bytes; it says nothing about whether
 * the issuer is honest. A signed `size` of `-1`, a signed `url` of
 * `javascript:…` and a signed season of `99999` are all perfectly well-formed
 * records — the proof is not a substitute for validation, and conflating the
 * two is how signed-data systems get compromised.
 */
function toMirrorRow(
  peer: FederationPeer,
  record: Record<string, unknown>,
  issuer: string,
) {
  const infoHash = asStr(record['bt:infohash_v1']);
  const name = asStr(record.name);
  if (!infoHash || !name) return null;

  const base = peer.baseUrl.replace(/\/$/, '');
  return {
    infoHash,
    contentSignature: asStr(record['trackarr:contentSignature']),
    name: name.slice(0, 1000),
    size: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, asNum(record['trackarr:size']))),
    description:
      typeof record.content === 'string' ? record.content.slice(0, 20_000) : null,
    categorySlug: asStr(record['trackarr:category']),
    categoryType: asStr(record['trackarr:categoryType']),
    isAdult: record['trackarr:isAdult'] === true,
    tags: Array.isArray(record['trackarr:tags'])
      ? (record['trackarr:tags'] as unknown[])
          .filter((t): t is string => typeof t === 'string')
          .slice(0, 50)
      : null,
    imdbId: asStr(record['trackarr:imdbId']),
    tmdbId: asStr(record['trackarr:tmdbId']),
    tvdbId: asStr(record['trackarr:tvdbId']),
    igdbId: asStr(record['trackarr:igdbId']),
    openlibraryId: asStr(record['trackarr:openlibraryId']),
    // The issuer's own position wins; the parser only fills a gap, and only
    // when the record offers no usable position at all. An issuer that never
    // parsed the name would otherwise cost every partner the season a release
    // belongs to — and a release with no season falls out of its group
    // entirely. A position the record DOES carry is never second-guessed: the
    // issuer saw the upload form, where a human may have corrected the parser.
    ...(() => {
      const season = asPosition(record['trackarr:season']);
      const episode = asPosition(record['trackarr:episode']);
      if (season !== null || episode !== null) return { season, episode };
      try {
        const parsed = parseReleaseName(name);
        return { season: parsed.season, episode: parsed.episode };
      } catch {
        return { season: null, episode: null };
      }
    })(),
    uploaderName: asStr(record['trackarr:uploaderName']),
    remoteCreatedAt: (() => {
      const d = asStr(record.published);
      const at = d ? new Date(d) : null;
      return at && !Number.isNaN(at.getTime()) ? at : null;
    })(),
    // The record's own `url` when it has one — that is where the release
    // actually lives, and it stays correct when the record was relayed. The
    // peer's address is only a fallback for a record minted before `url`
    // existed.
    remoteDetailUrl: asHttpUrl(record.url) ?? `${base}/torrents/${infoHash}`,
    remoteDownloadUrl: asHttpUrl(record.url) ?? `${base}/torrents/${infoHash}`,
    recordId: asStr(record.id),
    issuer,
    verified: true,
    // Swarm counts are deliberately absent from a record: they are perishable
    // and an immutable artefact cannot carry them. A freshly ingested row
    // therefore starts at zero and is filled by the stats pass.
    seeders: 0,
    leechers: 0,
    completed: 0,
  };
}

/**
 * Pull one partner's record stream and apply it.
 *
 * Best-effort by design: a partner that is down, slow, or serving nonsense
 * costs a logged cursor row and nothing else. Never throws — it runs in a loop
 * over every peer.
 */
/** What one record did to the mirror. */
export interface IngestOutcome {
  ingested: 0 | 1;
  withdrawn: number;
  rejected: 0 | 1;
  /** Set only on a first insert, so a re-sync does not re-notify followers. */
  fresh?: NewItem;
}

/**
 * Apply a single record to the mirror.
 *
 * Deliberately independent of how the record arrived: the periodic sync walks
 * a partner's stream, live search fans out and gets an answer back, a relay
 * may hand one over later. All three land here, and all three are checked the
 * same way — that is what makes "accepted on its proof" a property of the
 * system rather than of one code path.
 *
 * Never throws on a bad record: an unverifiable or malformed one is counted
 * and dropped, because losing a page over a single hostile item is exactly the
 * denial of service an unauthenticated feed invites.
 */
export async function ingestRecord(
  peer: FederationPeer,
  raw: unknown,
): Promise<IngestOutcome> {
  const nothing: IngestOutcome = { ingested: 0, withdrawn: 0, rejected: 0 };

  // The whole point: accepted on its proof, not on who sent it.
  const verdict = verifyRecord(raw);
  if (!verdict.ok) return { ...nothing, rejected: 1 };

  const record = raw as Record<string, unknown>;
  const replaces = asStr(record['trackarr:replaces']);

  if (record.type === 'Tombstone') {
    // A withdrawal is a statement, so it is applied rather than inferred from
    // a gap. Match the record it retires; fall back to the info hash for a
    // partner we started following after the fact.
    const hash = asStr(record['bt:infohash_v1']);
    const conditions = replaces
      ? and(
          eq(schema.remoteTorrents.peerId, peer.id),
          eq(schema.remoteTorrents.recordId, replaces),
        )!
      : hash
        ? and(
            eq(schema.remoteTorrents.peerId, peer.id),
            eq(schema.remoteTorrents.infoHash, hash),
          )!
        : null;
    if (!conditions) return nothing;
    const gone = await db.delete(schema.remoteTorrents).where(conditions);
    return {
      ...nothing,
      withdrawn: (gone as unknown as { count?: number }).count ?? 1,
    };
  }

  const row = toMirrorRow(peer, record, verdict.signer!);
  if (!row) return { ...nothing, rejected: 1 };

  // `xmax = 0` is true only for a fresh INSERT, which is what separates "a
  // partner published something new" from "a partner restated what we already
  // had" — and stops a re-sync from re-notifying every follower.
  const [written] = await db
    .insert(schema.remoteTorrents)
    .values({
      id: uuid(),
      peerId: peer.id,
      // The record IS the remote identity now. Reusing the existing
      // `(peer, remoteId)` unique index keeps one notion of "the same row from
      // this peer" rather than adding a second.
      remoteId: row.recordId!,
      fetchedAt: new Date(),
      ...row,
    })
    .onConflictDoUpdate({
      target: [schema.remoteTorrents.peerId, schema.remoteTorrents.remoteId],
      set: { ...row, updatedAt: new Date() },
    })
    .returning({ isNew: sql<boolean>`(xmax = 0)` });

  // An edit supersedes: drop the row the new record replaces, or the mirror
  // would carry both generations side by side.
  if (replaces) {
    await db
      .delete(schema.remoteTorrents)
      .where(
        and(
          eq(schema.remoteTorrents.peerId, peer.id),
          eq(schema.remoteTorrents.recordId, replaces),
        ),
      );
  }

  return {
    ...nothing,
    ingested: 1,
    fresh:
      written?.isNew && row.uploaderName
        ? {
            uploaderName: row.uploaderName,
            name: row.name,
            infoHash: row.infoHash,
          }
        : undefined,
  };
}

export async function syncPeerRecords(
  peer: FederationPeer,
): Promise<RecordSyncResult> {
  const out: RecordSyncResult = { ingested: 0, withdrawn: 0, rejected: 0, pages: 0 };
  /** First-seen uploads, for the follow notification after the sync settles. */
  const fresh: NewItem[] = [];

  const config = await getFederationConfig();
  if (!isFederationLive(config)) return out;
  const pk = getPrivateKeyPem(config!);
  if (!pk || !config!.instanceId) return out;

  const stored = await readCursor(peer.id);
  const isFirstSync = stored === null; // initial backfill — do NOT notify
  let cursor = stored ?? 0;

  const [{ existing }] = await db
    .select({ existing: sql<number>`count(*)::int` })
    .from(schema.remoteTorrents)
    .where(eq(schema.remoteTorrents.peerId, peer.id));
  if ((existing ?? 0) >= MAX_REMOTE_PER_PEER) {
    await saveCursor(peer.id, cursor, 'ok', 0, 'row cap reached');
    return out;
  }

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({
        since: String(cursor),
        limit: String(PAGE_LIMIT),
      });
      const res = await signedGet({
        baseUrl: peer.baseUrl,
        pathname: `/api/federation/records?${qs.toString()}`,
        instanceId: config!.instanceId,
        privateKeyPem: pk,
        audienceInstanceId: peer.instanceId ?? undefined,
      });
      if (res.status !== 200 || !Array.isArray(res.data?.records)) {
        await saveCursor(peer.id, cursor, 'error', out.ingested, `http ${res.status}`);
        out.error = `http ${res.status}`;
        return out;
      }
      out.pages++;

      const records = res.data.records as unknown[];
      if (!records.length) break;

      for (const raw of records) {
        const r = await ingestRecord(peer, raw);
        out.ingested += r.ingested;
        out.withdrawn += r.withdrawn;
        out.rejected += r.rejected;
        if (r.fresh) fresh.push(r.fresh);
      }

      const next = Number(res.data.nextCursor);
      // A cursor that does not advance would loop forever on the same page.
      if (!Number.isFinite(next) || next <= cursor) break;
      cursor = next;
      await saveCursor(peer.id, cursor, 'ok', out.ingested, null);
      if (records.length < PAGE_LIMIT) break;
    }

    await saveCursor(
      peer.id,
      cursor,
      out.rejected ? 'partial' : 'ok',
      out.ingested,
      out.rejected ? `${out.rejected} record(s) failed verification` : null,
    );

    await db
      .update(schema.federationPeers)
      .set({ lastSeenAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(schema.federationPeers.id, peer.id));

    if (!isFirstSync) await announceFresh(peer, fresh);
  } catch (err) {
    out.error = (err as Error).message;
    await saveCursor(peer.id, cursor, 'error', out.ingested, out.error);
    await db
      .update(schema.federationPeers)
      .set({ lastError: `Record sync: ${out.error}`, updatedAt: new Date() })
      .where(eq(schema.federationPeers.id, peer.id));
  }

  return out;
}

/**
 * Tell followers about first-seen uploads. After the cursor is safe, never
 * before: a notification that throws must not cost the records we ingested.
 */
export async function announceFresh(
  peer: FederationPeer,
  fresh: NewItem[],
): Promise<void> {
  if (!fresh.length) return;
  try {
    await notifyFollowersOfNewUploads(peer, fresh);
  } catch (err) {
    console.warn(
      '[RecordSync] follow notifications failed:',
      (err as Error).message,
    );
  }
}

/** Every partner that offers us a catalogue, one after another. */
export async function syncAllRecords(): Promise<{
  peers: number;
  ingested: number;
  withdrawn: number;
  rejected: number;
}> {
  const peers = (
    await db
      .select()
      .from(schema.federationPeers)
      .where(eq(schema.federationPeers.status, 'active'))
  ).filter((p) => p.acceptsFromThem?.catalog);

  const total = { peers: peers.length, ingested: 0, withdrawn: 0, rejected: 0 };
  for (const peer of peers) {
    const r = await syncPeerRecords(peer);
    total.ingested += r.ingested;
    total.withdrawn += r.withdrawn;
    total.rejected += r.rejected;
    if (r.ingested || r.withdrawn || r.rejected) {
      console.log(
        `[RecordSync] ${peer.displayName ?? peer.baseUrl}: ingested=${r.ingested} withdrawn=${r.withdrawn} rejected=${r.rejected}`,
      );
    }
  }
  return total;
}
