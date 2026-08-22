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
import { and, eq, inArray, sql } from 'drizzle-orm';
import { v4 as uuid } from 'uuid';
import { db, schema } from '@trackarr/db';
import type { FederationPeer } from '@trackarr/db/schema';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from './config';
import { parseReleaseName } from '@trackarr/shared/releaseParse';
import { signedPost } from './signing';
import { verifyRecord } from './record';
import { didKeyFromPublicKey } from './did';
import { notifyFollowersOfNewUploads } from './sidePasses';
import { mirrorSet } from './recordSet';
import { ingestIdentityRecord, ingestRevocation } from './identityRecord';
import {
  admit,
  dropSources,
  relayEnabled,
  repairMissingMirrors,
  unstoredSources,
  sourceRecord,
  trustedIssuers,
} from './relay';
import { MAX_ROUNDS, boundMessage, opening, respond, type Range } from './rbsr';

/** Records asked for per request. See `MAX_IDS` on the fetch endpoint. */
const FETCH_BATCH = 200;
/**
 * Records taken in per run. A first sync against a large partner is drained
 * over several ticks rather than in one request that times out halfway —
 * reconciliation is happy to be interrupted, since the next run simply finds
 * a smaller difference.
 */
const MAX_FETCH_PER_RUN = 5_000;
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
  /**
   * Round trips the reconciliation took. One means the two sides agreed
   * outright; a figure that climbs run after run means something is diverging
   * faster than it converges.
   */
  rounds: number;
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

/**
 * Have we ever synced this peer?
 *
 * The row used to hold a watermark and now holds only health, but this one
 * bit still matters: `null` means an initial backfill, which must not notify
 * followers about a partner's entire back catalogue at once.
 */
async function readState(peerId: string): Promise<{ rounds: number } | null> {
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
  if (!state) return null;
  const n = parseInt(state.cursor ?? '0', 10);
  return { rounds: Number.isFinite(n) ? n : 0 };
}

/**
 * Record how the last reconciliation went.
 *
 * `cursor` keeps its column but no longer means "where I stopped" — there is
 * no such place any more. It holds the number of round trips the last
 * conversation took, which is the one number that says whether reconciliation
 * is behaving: one means the two sides agreed immediately, and a figure that
 * climbs run after run means something is diverging faster than it converges.
 */
async function saveState(
  peerId: string,
  rounds: number,
  status: string,
  items: number,
  error: string | null,
): Promise<void> {
  const row = {
    cursor: String(rounds),
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

/** Leave a failure where the federation health page will show it. */
async function notePeerError(peerId: string, message: string): Promise<void> {
  await db
    .update(schema.federationPeers)
    .set({ lastError: `Record sync: ${message}`, updatedAt: new Date() })
    .where(eq(schema.federationPeers.id, peerId));
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
    // Who the issuer says wrote it. Kept as a DID rather than resolved to
    // anything local: it names a person on another instance, and the only
    // useful thing to do with it is recognise the same person again.
    authorDid: asStr(record.attributedTo),
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
  opts: {
    relayProof?: unknown;
    trusted?: Set<string>;
    /** Read once per batch; two queries per record otherwise. */
    relaying?: boolean;
    /** Our own signing identity, so we can recognise our own work coming back. */
    ownDid?: string | null;
  } = {},
): Promise<IngestOutcome> {
  const nothing: IngestOutcome = { ingested: 0, withdrawn: 0, rejected: 0 };

  // The whole point: accepted on its proof, not on who sent it.
  const verdict = verifyRecord(raw);
  if (!verdict.ok) return { ...nothing, rejected: 1 };

  const record = raw as Record<string, unknown>;

  // Verified is not the same as wanted. A valid proof from a stranger is a
  // valid proof from a stranger, and an instance that stored every record that
  // verified would be an open index rather than a curated catalogue. Either
  // the issuer is a partner, or a partner put its name to the introduction.
  const trusted = opts.trusted ?? (await trustedIssuers());
  const pass = admit(
    verdict.signer!,
    String(record.id ?? ''),
    opts.relayProof,
    trusted,
  );
  if (!pass.ok) return { ...nothing, rejected: 1 };

  // Noting the source is what reconciliation compares; keeping the bytes is
  // what relaying needs, and only that. Both go in the same transaction as the
  // mirror write below — a record we have sourced but not mirrored, or the
  // reverse, is a disagreement nothing later would notice or repair.
  const relaying = opts.relaying ?? (await relayEnabled());
  const replaces = asStr(record['trackarr:replaces']);

  // Our own work, handed back to us by a relay.
  //
  // Guaranteed the moment anybody relays for us: a relay serves what it took
  // in first-hand, and what it took in first-hand includes ours. Left alone,
  // an instance mirrors its whole catalogue once per relay — its own releases
  // showing up as remote, its mirror row cap spent on things it already has.
  // A three-instance mesh showed exactly that and nothing complained.
  //
  // The source is still recorded, deliberately. It is true — that partner does
  // serve this record — and it is what reconciliation compares: refusing to
  // note it would leave the record permanently missing from our side of the
  // comparison, re-fetched on every tick forever. That is the defect this
  // whole table exists to have fixed, and it would have been reintroduced by
  // the obvious version of this guard.
  const ownDid = opts.ownDid ?? null;
  if (ownDid && verdict.signer === ownDid) {
    await sourceRecord(record, verdict.signer!, pass.hops!, peer.id, relaying);
    return nothing;
  }

  if (record.type === 'Tombstone') {
    // A withdrawal is a statement, so it is applied rather than inferred from
    // a gap. Match the record it retires; fall back to the info hash for a
    // partner we started following after the fact.
    // Scoped to the tombstone's OWN issuer. `remote_torrents.issuer` records
    // who signed the mirrored record; matching on `(peer, recordId)` or
    // `(peer, infoHash)` alone would let any admitted issuer — including one
    // reaching us at two hops through a partner's relay — delete a mirror row
    // issued by somebody else entirely, simply by naming its infohash. A
    // withdrawal only speaks for the identity that made it.
    const hash = asStr(record['bt:infohash_v1']);
    const conditions = replaces
      ? and(
          eq(schema.remoteTorrents.peerId, peer.id),
          eq(schema.remoteTorrents.recordId, replaces),
          eq(schema.remoteTorrents.issuer, verdict.signer!),
        )!
      : hash
        ? and(
            eq(schema.remoteTorrents.peerId, peer.id),
            eq(schema.remoteTorrents.infoHash, hash),
            eq(schema.remoteTorrents.issuer, verdict.signer!),
          )!
        : null;
    let removed = 0;
    await db.transaction(async (tx) => {
      await sourceRecord(record, verdict.signer!, pass.hops!, peer.id, relaying, tx);
      if (!conditions) return;
      const gone = await tx.delete(schema.remoteTorrents).where(conditions);
      removed = (gone as unknown as { count?: number }).count ?? 1;
    });
    return { ...nothing, withdrawn: removed };
  }

  // An identity assertion is not a release. It goes to the alias graph, which
  // is what lets one person's work be gathered across instances — see
  // `identityRecord.ts` for why the identifiers stay distinct rather than
  // being merged into one.
  // A withdrawn identifier. Acted on rather than merely noted: recording that
  // we heard would leave a leaked key still proving things.
  if (record.type === 'Undo') {
    await sourceRecord(record, verdict.signer!, pass.hops!, peer.id, relaying);
    await ingestRevocation(
      peer.id,
      String(record.id ?? ''),
      verdict.signer!,
      record,
    );
    return nothing;
  }

  if (record.type === 'Person') {
    await sourceRecord(record, verdict.signer!, pass.hops!, peer.id, relaying);
    await ingestIdentityRecord(
      peer.id,
      String(record.id ?? ''),
      verdict.signer!,
      record,
    );
    return nothing;
  }

  const row = toMirrorRow(peer, record, verdict.signer!);
  if (!row) return { ...nothing, rejected: 1 };

  // `xmax = 0` is true only for a fresh INSERT, which is what separates "a
  // partner published something new" from "a partner restated what we already
  // had" — and stops a re-sync from re-notifying every follower.
  const [written] = await db.transaction(async (tx) => {
    await sourceRecord(record, verdict.signer!, pass.hops!, peer.id, relaying, tx);
    return tx
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
  });

  // An edit supersedes: drop the row the new record replaces, or the mirror
  // would carry both generations side by side. Same issuer scope as the
  // tombstone path — an edit signed by X may only retire X's own row.
  if (replaces) {
    await db
      .delete(schema.remoteTorrents)
      .where(
        and(
          eq(schema.remoteTorrents.peerId, peer.id),
          eq(schema.remoteTorrents.recordId, replaces),
          eq(schema.remoteTorrents.issuer, verdict.signer!),
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

/**
 * Reconcile with one partner, then fetch what we turn out to be missing.
 *
 * Two phases, and the split is the point. Reconciliation decides WHICH
 * records differ — cheaply, over fingerprints, converging in a handful of
 * round trips whatever the size of the catalogue. Fetching then asks for those
 * records by content address. Neither phase needs to know how the other
 * reached its answer, which is what lets the same fetch serve a record learned
 * from a relay, from a live search, or from here.
 *
 * What it costs in the common case — nothing new since last time — is one
 * request and one `skip` back. That is barely more than the watermark it
 * replaces, and unlike the watermark it has PROVEN the two sides agree rather
 * than assumed it.
 *
 * Best-effort throughout: a partner that is down, slow, or serving nonsense
 * costs a logged sync-state row and nothing else. Never throws — it runs in a
 * loop over every peer.
 */
export async function syncPeerRecords(
  peer: FederationPeer,
): Promise<RecordSyncResult> {
  const out: RecordSyncResult = {
    ingested: 0,
    withdrawn: 0,
    rejected: 0,
    rounds: 0,
  };
  /** First-seen uploads, for the follow notification after the sync settles. */
  const fresh: NewItem[] = [];

  const config = await getFederationConfig();
  if (!isFederationLive(config)) return out;
  const pk = getPrivateKeyPem(config!);
  if (!pk || !config!.instanceId) return out;

  const state = await readState(peer.id);
  const isFirstSync = state === null; // initial backfill — do NOT notify

  const [{ existing }] = await db
    .select({ existing: sql<number>`count(*)::int` })
    .from(schema.remoteTorrents)
    .where(eq(schema.remoteTorrents.peerId, peer.id));
  // At the cap we stop GROWING the mirror, not everything. Returning here — as
  // this used to — also skipped reconciliation and the withdrawal sweep, so the
  // mirror could never shrink back under the cap and the link was dead forever,
  // reported as `ok`. Now reconciliation still runs (so a partner's deletions
  // drain the mirror and it recovers), only the fetch of NEW records is
  // skipped, and the state is `partial` rather than `ok` so the dashboard shows
  // a degraded peer instead of a green one.
  const atCap = (existing ?? 0) >= MAX_REMOTE_PER_PEER;

  // Before comparing: forget any source whose mirror row has gone missing, so
  // the comparison finds the hole rather than reporting agreement over it.
  await repairMissingMirrors(peer.id);

  const mine = mirrorSet(peer.id);
  const missing: string[] = [];
  const extra: string[] = [];

  try {
    // Two queues rather than one `outgoing`. `toSend` is our questions for the
    // partner; `toProcess` is the partner's ranges we have not answered yet
    // because a previous round's reply hit its size budget. Both messages —
    // ours out and theirs back — are bounded, and neither side ever drops an
    // interval on the floor: the overflow waits its turn. This is what turns
    // the old `.slice` (which silently discarded up to 87% of the id space on a
    // large sync, and could build a request the partner permanently 413s) into
    // a sync that converges over as many rounds as it takes.
    let toSend = await opening(mine);
    let toProcess: Range[] = [];

    while ((toSend.length || toProcess.length) && out.rounds < MAX_ROUNDS) {
      out.rounds++;
      const { head: send, tail: sendOverflow } = boundMessage(toSend);
      const res = await signedPost({
        baseUrl: peer.baseUrl,
        pathname: '/api/federation/reconcile',
        body: { ranges: send },
        instanceId: config!.instanceId,
        privateKeyPem: pk,
        audienceInstanceId: peer.instanceId ?? undefined,
      });
      if (res.status !== 200 || !Array.isArray(res.data?.ranges)) {
        out.error = `http ${res.status}`;
        await saveState(peer.id, out.rounds, 'error', 0, out.error);
        await notePeerError(peer.id, out.error);
        return out;
      }
      // Ranges of ours the partner had no room to answer — re-ask them.
      const responderPending = Array.isArray(res.data?.pending)
        ? (res.data.pending as Range[])
        : [];

      // `echoIds: false` — we are the initiator. Answering their exact list
      // with ours would have the two of us handing lists back and forth.
      const step = await respond([...res.data.ranges, ...toProcess], mine, {
        echoIds: false,
      });
      missing.push(...step.missing);
      extra.push(...step.extra);
      // Next round: our new questions, plus the questions they skipped, plus
      // what we could not fit this round. Their answers we could not process go
      // to `toProcess` to be answered next round.
      toSend = [...step.reply, ...responderPending, ...sendOverflow];
      toProcess = step.pending;
    }

    // One read each for the whole fetch, not one per batch.
    const trusted = await trustedIssuers();
    const relaying = await relayEnabled();
    const ownDid = config!.publicKey ? didKeyFromPublicKey(config!.publicKey) : null;

    // ── Fetch what we are missing ────────────────────────────────────────
    //
    // Plus, while relaying, the records this partner serves whose bytes we
    // never kept. Reconciliation cannot ask for those: it compares which
    // records we hold FROM a partner, and by that measure we hold them. See
    // `unstoredSources` for why turning the switch on has to reach backwards.
    if (relaying) {
      missing.push(...(await unstoredSources(peer.id, MAX_FETCH_PER_RUN)));
    }
    // Skip fetching new records at the cap — but only the fetch. The `extra`
    // sweep below still runs, so the mirror keeps draining toward recovery.
    const wanted = atCap ? [] : [...new Set(missing)].slice(0, MAX_FETCH_PER_RUN);
    for (let i = 0; i < wanted.length; i += FETCH_BATCH) {
      const batch = wanted.slice(i, i + FETCH_BATCH);
      // In the body, not the query string: two hundred content addresses is
      // fifteen kilobytes, which is past what belongs in a URL and past what
      // this server's own middleware allows in one parameter.
      const res = await signedPost({
        baseUrl: peer.baseUrl,
        pathname: '/api/federation/records',
        body: { ids: batch },
        instanceId: config!.instanceId,
        privateKeyPem: pk,
        audienceInstanceId: peer.instanceId ?? undefined,
      });
      if (res.status !== 200 || !Array.isArray(res.data?.records)) {
        out.error = `http ${res.status}`;
        break;
      }
      for (const envelope of res.data.records as unknown[]) {
        const { record, relay } = unwrap(envelope);
        const r = await ingestRecord(peer, record, {
          relayProof: relay,
          trusted,
          relaying,
          ownDid,
        });
        out.ingested += r.ingested;
        out.withdrawn += r.withdrawn;
        out.rejected += r.rejected;
        if (r.fresh) fresh.push(r.fresh);
      }
    }

    // ── Drop what the partner no longer publishes ────────────────────────
    //
    // An absence IS a withdrawal, and this is where reconciliation earns its
    // keep: no tombstone had to be sent, and a deletion we somehow missed is
    // caught on the next pass rather than never.
    //
    // Safe because `extra` only ever comes from an interval whose contents we
    // saw in full — never inferred from a fingerprint — so a reconciliation
    // that failed halfway deletes nothing it should not.
    const gone = [...new Set(extra)];
    for (let i = 0; i < gone.length; i += FETCH_BATCH) {
      const batch = gone.slice(i, i + FETCH_BATCH);
      const res = await db
        .delete(schema.remoteTorrents)
        .where(
          and(
            eq(schema.remoteTorrents.peerId, peer.id),
            inArray(schema.remoteTorrents.remoteId, batch),
          ),
        );
      out.withdrawn += (res as unknown as { count?: number }).count ?? batch.length;
      // And stop calling this partner a source. Without it the record stays in
      // the set we compare, so the next round would report it missing again —
      // which is the shape of the defect this whole change exists to fix, just
      // pointing the other way.
      await dropSources(peer.id, batch);
    }

    await saveState(
      peer.id,
      out.rounds,
      atCap || out.rejected ? 'partial' : out.error ? 'error' : 'ok',
      out.ingested,
      atCap
        ? 'row cap reached — not fetching new records until the mirror drains'
        : out.rejected
          ? `${out.rejected} record(s) failed verification`
          : (out.error ?? null),
    );

    await db
      .update(schema.federationPeers)
      .set({ lastSeenAt: new Date(), lastError: null, updatedAt: new Date() })
      .where(eq(schema.federationPeers.id, peer.id));

    if (!isFirstSync) await announceFresh(peer, fresh);
  } catch (err) {
    out.error = (err as Error).message;
    await saveState(peer.id, out.rounds, 'error', out.ingested, out.error);
    await notePeerError(peer.id, out.error);
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

/**
 * Read one item off the wire, whichever shape it is in.
 *
 * A partner that relays sends `{ record, relay }`; one that only serves its
 * own may send the record bare. Accepting both costs four lines and means the
 * two do not have to be upgraded in step.
 */
export function unwrap(item: unknown): { record: unknown; relay: unknown } {
  if (item && typeof item === 'object' && 'record' in item) {
    const e = item as { record: unknown; relay?: unknown };
    return { record: e.record, relay: e.relay ?? null };
  }
  return { record: item, relay: null };
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
        `[RecordSync] ${peer.displayName ?? peer.baseUrl}: ingested=${r.ingested} withdrawn=${r.withdrawn} rejected=${r.rejected} rounds=${r.rounds}`,
      );
    }
  }
  return total;
}
