/**
 * The signed catalogue record — the change the whole decentralisation rests on.
 *
 * Until now trust came from the CHANNEL: an Ed25519 signature over the HTTP
 * request. That is enough to know who you are talking to and nothing more. It
 * cannot answer "did C really say this?" about something B handed you, so every
 * instance must fetch from every other instance itself. That single property is
 * what makes the mesh O(N²), makes a catalogue die with its host, and makes
 * relaying, caching and gossip impossible.
 *
 * Signing the RECORD instead moves trust into the data. A record verifies on
 * its own, in the hands of anybody, having arrived by any route. Everything
 * else — relays, reconciliation, a catalogue outliving its instance — becomes
 * possible without further protocol.
 *
 * ## Shape
 *
 * ActivityStreams `Torrent` per FEP-d8c8 (merged 2025-11-06), with our own
 * terms under a `trackarr:` prefix. The FEP covers identity — infohashes,
 * magnet — and the AS2 base covers name, description, author and date;
 * everything a catalogue needs beyond that (category, external media ids,
 * series position, tags) is ours, which the FEP explicitly allows.
 *
 * The point is not full interoperability today. It is that a third party can
 * *recognise and fetch* what we publish, and that we never have to break the
 * format to get there.
 *
 * ## Proof
 *
 * W3C Data Integrity, cryptosuite `eddsa-jcs-2022`: canonicalise with JCS
 * (RFC 8785), hash with SHA-256, sign with Ed25519 — the curve the instance
 * identity already uses. The signed bytes are
 * `sha256(canonical(proofConfig)) || sha256(canonical(document))`, so the proof
 * covers its own metadata as well as the record. Changing the creation date or
 * the key it claims to be from invalidates it just as surely as changing the
 * name.
 *
 * ## Identity
 *
 * `id` is the record's content address: `sha256:<hex>` over the canonical
 * document without its proof. Two instances publishing the same release produce
 * different records (different issuers), and the same record relayed through
 * ten hops stays one record. That is what turns deduplication from a heuristic
 * over content signatures into an equality test.
 */
import { createHash, sign as edSign, verify as edVerify } from 'node:crypto';
import { canonicalBytes } from './jcs';
import {
  didFromVerificationMethod,
  publicKeyFromDidKey,
  verificationMethodFor,
} from './did';

export const CRYPTOSUITE = 'eddsa-jcs-2022';
export const PROOF_TYPE = 'DataIntegrityProof';

/** Served alongside the records; the URL is stable and versioned by content. */
export const CONTEXT = [
  'https://www.w3.org/ns/activitystreams',
  'https://w3id.org/fep/d8c8.jsonld',
  'https://w3id.org/security/data-integrity/v2',
];

export interface DataIntegrityProof {
  type: typeof PROOF_TYPE;
  cryptosuite: typeof CRYPTOSUITE;
  created: string;
  verificationMethod: string;
  proofPurpose: 'assertionMethod';
  /** Multibase base64url, `u` prefix — permitted, and shorter than base58. */
  proofValue: string;
}

/**
 * A catalogue record before it is signed.
 *
 * Deliberately flat and deliberately small. Anything that is not a fact about
 * the release — swarm counts, local moderation state, who has it — is excluded:
 * a record is immutable, and a number that changes hourly has no business
 * inside something that is signed once and cached forever. Swarm figures travel
 * separately, unsigned, as the perishable data they are.
 */
export interface UnsignedRecord {
  '@context': string[];
  type: 'Torrent';
  /** Content address, filled by `signRecord`. */
  id?: string;

  /** FEP-d8c8. v1 today; v2 when the catalogue carries it. */
  'bt:infohash_v1': string;
  'bt:magnet'?: string;

  /** ActivityStreams. */
  name: string;
  content?: string | null;
  /** Where the release lives, on the instance that published it. */
  url?: string | null;
  published: string;
  attributedTo?: string | null;

  /** Ours. */
  'trackarr:size': number;
  'trackarr:contentSignature'?: string | null;
  'trackarr:category'?: string | null;
  'trackarr:categoryType'?: string | null;
  'trackarr:isAdult': boolean;
  'trackarr:tags': string[];
  'trackarr:imdbId'?: string | null;
  'trackarr:tmdbId'?: string | null;
  'trackarr:tvdbId'?: string | null;
  'trackarr:igdbId'?: string | null;
  'trackarr:openlibraryId'?: string | null;
  'trackarr:season'?: number | null;
  'trackarr:episode'?: number | null;
  /** The instance that published it. */
  'trackarr:issuer': string;
  /** What this record replaces, when it is an edit. */
  'trackarr:replaces'?: string | null;
}

export interface SignedRecord extends UnsignedRecord {
  id: string;
  proof: DataIntegrityProof;
}

export class RecordError extends Error {}

function sha256(bytes: Buffer): Buffer {
  return createHash('sha256').update(bytes).digest();
}

/**
 * The content address of a record: the hash of its canonical form, proof and
 * id excluded.
 *
 * Excluding the proof is what makes the address stable across re-signing;
 * excluding the id is what stops it being self-referential.
 */
export function recordId(record: UnsignedRecord | SignedRecord): string {
  const { proof: _p, id: _i, ...document } = record as SignedRecord;
  return `sha256:${sha256(canonicalBytes(document)).toString('hex')}`;
}

/** The bytes a proof signs: its own configuration, then the document. */
function signingInput(
  document: Record<string, unknown>,
  proofConfig: Record<string, unknown>,
): Buffer {
  return Buffer.concat([
    sha256(canonicalBytes(proofConfig)),
    sha256(canonicalBytes(document)),
  ]);
}

/**
 * A proof over an arbitrary document, and the check for one.
 *
 * Split out of `signRecord`/`verifyRecord` because a torrent record is not the
 * only thing this instance signs: an identity assertion is a different
 * document with a different notion of `id`, and the one thing that must NOT
 * differ between them is how the bytes are canonicalised and covered. Two
 * implementations of "sign a JSON document" is precisely the drift that ends
 * with one of them verifying something the other would reject.
 */
export function makeProof(
  document: Record<string, unknown>,
  opts: SignOptions,
): DataIntegrityProof {
  const proofConfig = {
    type: PROOF_TYPE,
    cryptosuite: CRYPTOSUITE,
    created: (opts.created ?? new Date()).toISOString(),
    verificationMethod: verificationMethodFor(opts.did),
    proofPurpose: 'assertionMethod' as const,
  };
  const signature = edSign(
    null,
    signingInput(document, proofConfig),
    opts.privateKeyPem,
  );
  return { ...proofConfig, proofValue: `u${signature.toString('base64url')}` };
}

/**
 * Check one proof against one document. Total: it runs on bytes a stranger
 * chose, so it reports a reason rather than throwing.
 */
export function checkProof(
  document: Record<string, unknown>,
  proof: unknown,
): VerifyResult {
  try {
    if (!proof || typeof proof !== 'object') {
      return { ok: false, reason: 'no proof' };
    }
    const p = proof as DataIntegrityProof;
    if (p.type !== PROOF_TYPE || p.cryptosuite !== CRYPTOSUITE) {
      return { ok: false, reason: 'unsupported proof suite' };
    }
    if (p.proofPurpose !== 'assertionMethod') {
      return { ok: false, reason: 'wrong proof purpose' };
    }
    if (typeof p.proofValue !== 'string' || p.proofValue[0] !== 'u') {
      return { ok: false, reason: 'malformed proofValue' };
    }
    if (typeof p.verificationMethod !== 'string') {
      return { ok: false, reason: 'no verification method' };
    }
    const { proofValue, ...proofConfig } = p;
    const did = didFromVerificationMethod(p.verificationMethod);
    const key = publicKeyFromDidKey(did);
    const ok = edVerify(
      null,
      signingInput(document, proofConfig as unknown as Record<string, unknown>),
      key,
      Buffer.from(proofValue.slice(1), 'base64url'),
    );
    return ok ? { ok, signer: did } : { ok: false, reason: 'bad signature' };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}

export interface SignOptions {
  privateKeyPem: string;
  /** `did:key:…` of the signer. */
  did: string;
  /** Overridable so a test can be deterministic. */
  created?: Date;
}

export function signRecord(
  record: UnsignedRecord,
  opts: SignOptions,
): SignedRecord {
  const id = recordId(record);
  const { proof: _p, id: _i, ...rest } = record as SignedRecord;
  const document = { ...rest, id } as Record<string, unknown>;

  return {
    ...(document as unknown as UnsignedRecord),
    id,
    proof: makeProof(document, opts),
  };
}

export interface VerifyResult {
  ok: boolean;
  /** Why it failed. Never shown to a partner — logged, and used to score them. */
  reason?: string;
  /** The DID that signed it, once the signature checks out. */
  signer?: string;
}

/**
 * Verify a record on its own terms.
 *
 * No network, no state, no peer table: the key is inside the `did:key`, the
 * canonicalisation is deterministic, and the proof covers everything that
 * matters. This function is the reason a record can be relayed — and the reason
 * it must be **total**, because it runs on bytes a stranger chose.
 */
export function verifyRecord(record: unknown): VerifyResult {
  try {
    if (!record || typeof record !== 'object') {
      return { ok: false, reason: 'not an object' };
    }
    const r = record as SignedRecord;

    // The id is part of the document AND derived from it, so a record whose id
    // does not match its content is rejected before any cryptography — a
    // mismatched id would let one record masquerade as another in every cache
    // that keys on it.
    const expected = recordId(r);
    if (r.id !== expected) {
      return { ok: false, reason: 'id does not match content' };
    }

    const { proof, ...document } = r as unknown as Record<string, unknown>;
    return checkProof(document, proof);
  } catch (err) {
    // A stranger's bytes must never throw out of here: an exception on a
    // malformed record would take down whatever loop is ingesting a page of
    // them.
    return { ok: false, reason: (err as Error).message };
  }
}
