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
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
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
export async function keepForRelay(
  record: Record<string, unknown>,
  issuer: string,
  hops: number,
): Promise<void> {
  const id = typeof record.id === 'string' ? record.id : null;
  if (!id) return;

  await db
    .insert(schema.catalogRecords)
    .values({
      id,
      torrentId: null,
      infoHash:
        typeof record['bt:infohash_v1'] === 'string'
          ? (record['bt:infohash_v1'] as string)
          : null,
      issuer,
      kind:
        record.type === 'Tombstone'
          ? 'tombstone'
          : record.type === 'Person'
            ? 'identity'
            : record.type === 'Undo'
              ? 'revocation'
              : 'torrent',
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
  const replaces = record['trackarr:replaces'];
  if (typeof replaces === 'string' && replaces) {
    await db
      .update(schema.catalogRecords)
      .set({ supersededAt: new Date() })
      .where(
        and(
          eq(schema.catalogRecords.id, replaces),
          isNull(schema.catalogRecords.supersededAt),
        ),
      );
  }
}

/** Whether this instance is willing to carry other people's records. */
export async function relayEnabled(): Promise<boolean> {
  const [config] = await db
    .select({ relayEnabled: schema.federationConfig.relayEnabled })
    .from(schema.federationConfig)
    .limit(1);
  return config?.relayEnabled === true;
}
