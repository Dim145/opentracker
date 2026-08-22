/**
 * Handing on somebody else's records, and deciding whose to accept.
 *
 * Once a record verifies on its own proof, the route it took stops mattering —
 * that was the point of step 4, and this is what it was for. A partner can
 * hand over what it holds from a third instance, and the mesh where everybody
 * polls everybody becomes a star: O(N) links instead of O(N²), and the
 * handshake problem the fediverse walked into is structurally avoided.
 *
 * ## Authentic is not the same as wanted
 *
 * Anybody can mint a keypair and sign a record. Verification says the issuer
 * really wrote those bytes; it says nothing about whether we want their
 * catalogue. An instance that accepted every record that verified would be an
 * open index — a different project, and not this one. What makes a private
 * tracker worth running is that its catalogue is curated, and relaying must
 * not quietly undo that.
 *
 * ## The countersignature, and why it is not a peer list
 *
 * So a relayed record arrives with a **countersignature**: the relay signs
 * "I am handing you this one", and we accept it because we already trust the
 * relay. The alternative — asking partners for their partner lists and
 * accepting anyone two hops out — is worse in a way that only shows later: it
 * is unattributable. With a countersignature, a relay that hands on rubbish
 * has signed the fact. We can point at it, and drop it.
 *
 * ## Two hops, enforced where it can be enforced
 *
 * We relay what we took **first-hand** and never what was relayed to us. That
 * bounds the network at two hops from any origin, and it is bounded by each
 * instance about its own behaviour rather than by asking a partner how far a
 * record has come — a partner that lies about that is exactly the case the
 * bound exists for.
 *
 * ## What a relay cannot do
 *
 * Forge, alter, or attribute. Every record carries its own proof, so a relay's
 * only powers are omission and delay. That is why relaying can be offered to
 * partners without asking them to extend it any trust at all — and why asking
 * several relays, or none, is always a valid strategy.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';

/**
 * A database handle, or the transaction standing in for one.
 *
 * Narrowed to what these functions use rather than to drizzle's full type: a
 * transaction is not a `PostgresJsDatabase` and saying it is would be a lie the
 * compiler catches. This says what is actually needed — insert, update, delete
 * — which both satisfy.
 */
type Writer = Pick<typeof db, 'insert' | 'update' | 'delete'>;
import { didKeyFromPublicKey } from './did';
import { checkProof, makeProof, type DataIntegrityProof } from './record';

/** A record on the wire, with the vouching that carried it here. */
export interface Envelope {
  record: unknown;
  /** Present only when the sender is passing on somebody else's work. */
  relay?: DataIntegrityProof | null;
}

/**
 * What a relay signs.
 *
 * The record's id and nothing else, because the id IS the content: signing it
 * binds the whole record without duplicating a byte of it. Adding anything to
 * the record itself was never an option — its address covers its content, so a
 * field appended in transit would change what it is called.
 */
export function relayStatement(recordId: string, relayDid: string): Record<string, unknown> {
  return {
    type: 'Announce',
    object: recordId,
    'trackarr:issuer': relayDid,
  };
}

/** Sign "I am handing you this one". */
export function countersign(
  recordId: string,
  relayDid: string,
  privateKeyPem: string,
): DataIntegrityProof {
  return makeProof(relayStatement(recordId, relayDid), {
    privateKeyPem,
    did: relayDid,
  });
}

/** The DID that vouched for a relayed record, or null if nobody did. */
export function countersigner(
  recordId: string,
  proof: unknown,
): string | null {
  if (!proof || typeof proof !== 'object') return null;
  const vm = (proof as DataIntegrityProof).verificationMethod;
  if (typeof vm !== 'string') return null;
  const did = vm.split('#')[0] ?? '';
  // Checked against a statement rebuilt from the id WE computed, never from
  // one the sender supplied: a countersignature over an id we did not derive
  // ourselves would vouch for whatever the sender said it vouched for.
  const verdict = checkProof(relayStatement(recordId, did), proof);
  return verdict.ok && verdict.signer === did ? did : null;
}

/**
 * The instances whose records we will store: ours, and our active partners'.
 *
 * Read fresh rather than cached. A partner that was just suspended must stop
 * being a reason to accept anything, and a cache measured in minutes is a
 * window in which it still is.
 */
export async function trustedIssuers(): Promise<Set<string>> {
  const out = new Set<string>();

  const [config] = await db
    .select({ publicKey: schema.federationConfig.publicKey })
    .from(schema.federationConfig)
    .limit(1);
  if (config?.publicKey) {
    try {
      out.add(didKeyFromPublicKey(config.publicKey));
    } catch {
      /* an unusable local key is a bigger problem, reported elsewhere */
    }
  }

  const peers = await db
    .select({ publicKey: schema.federationPeers.publicKey })
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.status, 'active'));
  for (const p of peers) {
    if (!p.publicKey) continue;
    try {
      out.add(didKeyFromPublicKey(p.publicKey));
    } catch {
      /* a partner we cannot name is a partner we cannot trust */
    }
  }

  return out;
}

export interface Admission {
  ok: boolean;
  reason?: string;
  /** 1 when it came from its issuer, 2 when a partner relayed it. */
  hops?: number;
  /** Who vouched, on a relayed record. */
  via?: string;
}

/**
 * Decide whether to take a record in, given who issued it and who vouched.
 *
 * Two ways in, and no third. Either the issuer is a partner of ours — first
 * hand, one hop — or a partner countersigned it, which is that partner putting
 * its name to the introduction. Anything else is refused, however impeccable
 * its signature: a valid proof from a stranger is a valid proof from a
 * stranger.
 */
export function admit(
  issuer: string,
  recordId: string,
  relayProof: unknown,
  trusted: Set<string>,
): Admission {
  if (trusted.has(issuer)) return { ok: true, hops: 1 };

  const via = countersigner(recordId, relayProof);
  if (!via) {
    return { ok: false, reason: 'issuer is not a partner and nobody vouched' };
  }
  if (!trusted.has(via)) {
    return { ok: false, reason: 'vouched for by an instance we do not federate with' };
  }
  // Vouching for yourself is not a case that needs its own rejection: an
  // issuer who is trusted took the first branch, and one who is not cannot be
  // a trusted voucher either. A guard for it here would look like a security
  // check and never fire, which is worse than none — the day somebody reorders
  // these two branches it would go on looking like protection.
  return { ok: true, hops: 2, via };
}

/**
 * Keep a copy of a record we took in, so it can be handed on.
 *
 * The mirror row is the view — denormalised for browsing, one per partner.
 * This is the store: the bytes, exactly as signed, which is the only form a
 * record can be relayed in. Reconstructing one from the mirror would be a
 * second implementation of the format, and it would eventually disagree with
 * the proof.
 */
/** What sort of statement a record is, from its AS2 type. */
export function kindOf(record: Record<string, unknown>): string {
  switch (record.type) {
    case 'Tombstone':
      return 'tombstone';
    case 'Person':
      return 'identity';
    case 'Undo':
      return 'revocation';
    default:
      return 'torrent';
  }
}

export async function keepForRelay(
  record: Record<string, unknown>,
  issuer: string,
  hops: number,
  tx: Writer = db,
): Promise<void> {
  const id = typeof record.id === 'string' ? record.id : null;
  if (!id) return;

  await tx
    .insert(schema.catalogRecords)
    .values({
      id,
      torrentId: null,
      infoHash:
        typeof record['bt:infohash_v1'] === 'string'
          ? (record['bt:infohash_v1'] as string)
          : null,
      issuer,
      kind: kindOf(record),
      body: record,
      // The address of a record with no lineage IS its fingerprint; for one
      // that supersedes another they differ, and we have no way to recompute
      // the fingerprint of somebody else's projection. The id is the honest
      // answer, and nothing local reads this column for an ingested record.
      contentHash: id,
      supersedes:
        typeof record['trackarr:replaces'] === 'string'
          ? (record['trackarr:replaces'] as string)
          : null,
      origin: 'ingested',
      hops,
    })
    .onConflictDoNothing({ target: schema.catalogRecords.id });

  // A record that supersedes another retires it here too, or we would go on
  // offering a generation its own issuer has replaced.
  //
  // Scoped to the SAME issuer, and that scope is load-bearing. `replaces` is an
  // arbitrary string from a peer's record and `catalog_records.id` is a global
  // content address — our own local records share the table. Without the issuer
  // check, any partner (relaying on) could mint a valid record naming one of
  // OUR ids in `replaces` and permanently un-publish it: gone from the served
  // set, the public outbox and live search, and a first-generation re-mint
  // recomputes the same id so `onConflictDoNothing` never restores it. A record
  // may only retire a generation from the identity that signed it.
  const replaces = record['trackarr:replaces'];
  if (typeof replaces === 'string' && replaces) {
    await tx
      .update(schema.catalogRecords)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(schema.catalogRecords.id, replaces),
          eq(schema.catalogRecords.issuer, issuer),
          isNull(schema.catalogRecords.supersededAt),
        ),
      );
  }
}

/**
 * Note that a partner serves a record, and keep the bytes if we will relay it.
 *
 * The association is always recorded: it is two identifiers, it is what
 * reconciliation compares, and it is how we know a record is still wanted.
 *
 * The BODY is kept only when this instance relays. It is the larger cost by
 * three orders of magnitude — measured at about 1.4 kB a record — and an
 * instance that will never hand one on has no use for it: the mirror row
 * carries everything the interface reads.
 *
 * Turning relaying on later reaches backwards — see `unstoredSources`. An
 * earlier version of this comment argued it did not need to, on the grounds
 * that the served set is computed from what we hold and is therefore never
 * larger than the truth. True, and beside the point: a live mesh showed an
 * instance that had switched relaying on carrying precisely nothing, forever,
 * because reconciliation had already agreed with the partner and would never
 * ask again.
 */
export async function sourceRecord(
  record: Record<string, unknown>,
  issuer: string,
  hops: number,
  peerId: string,
  relaying: boolean,
  tx: Writer = db,
): Promise<void> {
  const id = typeof record.id === 'string' ? record.id : null;
  if (!id) return;

  await tx
    .insert(schema.recordSources)
    .values({ recordId: id, peerId, kind: kindOf(record) })
    .onConflictDoNothing({
      target: [schema.recordSources.peerId, schema.recordSources.recordId],
    });

  if (relaying) await keepForRelay(record, issuer, hops, tx);
}

/**
 * A partner has stopped serving these. Forget that it did, and forget the
 * records themselves once nobody serves them at all.
 *
 * Two steps rather than one because they answer different questions. Losing a
 * source is a fact about that partner; losing the last source is what makes a
 * record something we no longer hold — and only then is there anything to
 * clean up.
 */
/**
 * Delete every ingested record no source references any more.
 *
 * `catalog_records` has no foreign key to `federation_peers` (a record can
 * outlive the peer that introduced it), so cascading a peer delete leaves its
 * ingested records behind — held, relayed onward, and impossible to remove
 * through the product. This is the sweep that collects them: a record we took
 * from partners, that no `record_sources` row points at any more, has no
 * reason to exist. Our own (`origin='local'`) records are never touched.
 */
export async function purgeOrphanedIngested(): Promise<number> {
  const res = await db
    .delete(schema.catalogRecords)
    .where(
      and(
        eq(schema.catalogRecords.origin, 'ingested'),
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.recordSources} rs
           WHERE rs.record_id = ${schema.catalogRecords.id})`,
      ),
    );
  return (res as unknown as { count?: number }).count ?? 0;
}

/**
 * Forget everything we hold on one peer's behalf.
 *
 * Cutting a link is supposed to purge the cached remote data — the schema says
 * so on the `status` column — and nothing did it. This removes the mirror, the
 * sources and the alias assertions we ingested from the peer, optionally its
 * public key (so its signed requests stop verifying for good), and then sweeps
 * any ingested record left orphaned by the removal. It deliberately leaves our
 * members' own data alone: `federated_identities` (accounts they proved) and
 * `federated_follows` (people they chose to follow) are theirs, not the peer's.
 */
export async function forgetPeerData(
  peerId: string,
  opts: { forgetKey?: boolean } = {},
): Promise<void> {
  await db.delete(schema.remoteTorrents).where(eq(schema.remoteTorrents.peerId, peerId));
  await db.delete(schema.recordSources).where(eq(schema.recordSources.peerId, peerId));
  await db
    .delete(schema.remoteIdentityLinks)
    .where(eq(schema.remoteIdentityLinks.peerId, peerId));
  if (opts.forgetKey) {
    await db
      .update(schema.federationPeers)
      .set({ publicKey: null })
      .where(eq(schema.federationPeers.id, peerId));
  }
  await purgeOrphanedIngested();
}

/**
 * Note that a partner serves a record we looked at and will not take.
 *
 * A verified-but-unwanted record (issuer not admitted, or a Torrent record
 * with no usable name/infohash) used to return before it was sourced, so
 * reconciliation kept reporting it missing and we re-fetched it every tick,
 * forever, for nothing. Recording it as a source with a `rejected` kind puts
 * it in the compared set — the re-fetch stops — while keeping it out of the
 * mirror and out of `repairMissingMirrors`, which only ever repairs torrents.
 * If the partner stops serving it, the ordinary `extra` sweep drops it like
 * any other source.
 */
export async function sourceRejected(
  peerId: string,
  recordId: string,
): Promise<void> {
  if (!recordId) return;
  await db
    .insert(schema.recordSources)
    .values({ recordId, peerId, kind: 'rejected' })
    .onConflictDoNothing({
      target: [schema.recordSources.peerId, schema.recordSources.recordId],
    });
}

export async function dropSources(
  peerId: string,
  recordIds: string[],
): Promise<void> {
  if (!recordIds.length) return;

  await db
    .delete(schema.recordSources)
    .where(
      and(
        eq(schema.recordSources.peerId, peerId),
        inArray(schema.recordSources.recordId, recordIds),
      ),
    );

  // Anything still served by somebody else stays. A record we minted stays
  // whatever partners do with it — it is ours, and their silence is not a
  // retraction of our own publication.
  const stillSourced = await db
    .select({ recordId: schema.recordSources.recordId })
    .from(schema.recordSources)
    .where(inArray(schema.recordSources.recordId, recordIds));
  const keep = new Set(stillSourced.map((r) => r.recordId));
  const orphaned = recordIds.filter((id) => !keep.has(id));
  if (!orphaned.length) return;

  await db
    .delete(schema.catalogRecords)
    .where(
      and(
        inArray(schema.catalogRecords.id, orphaned),
        eq(schema.catalogRecords.origin, 'ingested'),
      ),
    );
}

/**
 * Forget any source whose mirror row has gone missing.
 *
 * The mirror is a view of torrents derived from records, and the set we
 * reconcile is the sources — so a mirror row lost to a bug or a manual delete
 * would never be noticed: our set still says we hold the record, the partner
 * agrees, and both sides report success over a hole.
 *
 * Dropping the source is the repair. It costs one round trip on the next
 * reconciliation and restores exactly the self-healing that comparing the
 * mirror used to give for free — without the permanent re-fetching of every
 * record that was never a torrent, which is what it cost.
 */
/**
 * Records a partner serves us, whose bytes we do not hold.
 *
 * The other half of making storage conditional. Turning relaying ON used to be
 * retroactive by accident — the bytes were kept whether or not they would ever
 * be served, so the moment the switch flipped there was something to serve.
 * Splitting storage out fixed the waste and broke that: reconciliation is
 * quiet once the sets agree, so nothing would ever be fetched again and the
 * instance would carry only what happened to arrive afterwards. An operator
 * reading "carrying partners' records and handing them on" would have been
 * told something that was not true of anything already in the catalogue.
 *
 * So the fetch list is topped up with these. It converges: every kind of
 * record is stored by `keepForRelay`, so what is fetched here is held
 * afterwards and does not come back. Bounded, because the first pass after the
 * switch asks for a partner's whole catalogue.
 */
export async function unstoredSources(
  peerId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ recordId: schema.recordSources.recordId })
    .from(schema.recordSources)
    .leftJoin(
      schema.catalogRecords,
      eq(schema.catalogRecords.id, schema.recordSources.recordId),
    )
    .where(
      and(
        eq(schema.recordSources.peerId, peerId),
        isNull(schema.catalogRecords.id),
      ),
    )
    .limit(limit);
  return rows.map((r) => r.recordId);
}

export async function repairMissingMirrors(peerId: string): Promise<number> {
  const orphaned = await db
    .select({ recordId: schema.recordSources.recordId })
    .from(schema.recordSources)
    .leftJoin(
      schema.remoteTorrents,
      and(
        eq(schema.remoteTorrents.peerId, schema.recordSources.peerId),
        eq(schema.remoteTorrents.remoteId, schema.recordSources.recordId),
      ),
    )
    .where(
      and(
        eq(schema.recordSources.peerId, peerId),
        eq(schema.recordSources.kind, 'torrent'),
        isNull(schema.remoteTorrents.id),
        // Not one of ours. A record we published has no mirror row and never
        // should — it is already in the catalogue as itself — so it looks
        // exactly like a lost one from here. Forgetting the source would make
        // reconciliation report it missing, fetch it, skip it as ours, and
        // come round again on the next tick: the very loop this repair sits
        // next to. Caught by a test written for the guard above, not for this.
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.catalogRecords} own
           WHERE own.id = ${schema.recordSources.recordId}
             AND own.origin = 'local')`,
      ),
    );
  if (!orphaned.length) return 0;

  await db
    .delete(schema.recordSources)
    .where(
      and(
        eq(schema.recordSources.peerId, peerId),
        inArray(
          schema.recordSources.recordId,
          orphaned.map((r) => r.recordId),
        ),
      ),
    );
  return orphaned.length;
}

/** Whether this instance is willing to carry other people's records. */
export async function relayEnabled(): Promise<boolean> {
  const [config] = await db
    .select({ relayEnabled: schema.federationConfig.relayEnabled })
    .from(schema.federationConfig)
    .limit(1);
  return config?.relayEnabled === true;
}
