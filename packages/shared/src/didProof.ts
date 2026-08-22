/**
 * The three things a server and a browser must produce identically.
 *
 * Member-held keys mean a proof is now made in two places: the instance signs
 * its endorsement in Node, the member signs their own claim in a browser tab.
 * Both cover the same document, and "the same" has to mean byte-for-byte —
 * a canonicalisation that differs in one escape, a signing input assembled in
 * a different order, an identifier encoded with a different alphabet, and the
 * two halves of one document disagree about what was signed.
 *
 * That failure does not announce itself. The document verifies on one side and
 * not the other, or worse, verifies against bytes nobody meant. So the parts
 * that must agree live here, once, and both sides import them:
 *
 *   1. JSON canonicalisation (RFC 8785)
 *   2. how a signing input is assembled from a document and a proof config
 *   3. `did:key` encoding of an Ed25519 public key
 *
 * What is NOT here is the cryptography itself. Node hashes and signs with
 * `node:crypto`, the browser with `crypto.subtle`, and neither has any business
 * pretending to be the other — so the composition takes a digest function and
 * lets each platform supply its own.
 *
 * Everything is `Uint8Array` rather than `Buffer`: a browser has no `Buffer`,
 * and a shared module that assumed one would be shared in name only.
 */

export class CanonicalisationError extends Error {}

/** A catalogue record is three levels deep; anything near this is hostile. */
const MAX_DEPTH = 64;

/**
 * The canonical form of a JSON value, per RFC 8785.
 *
 * Throws rather than coercing. A document carrying `undefined`, a function or
 * a `NaN` is a bug upstream, and quietly dropping the field would produce a
 * signature over something other than what the caller thought they signed —
 * the worst possible failure for a signing primitive.
 */
export function canonicalise(value: unknown): string {
  return write(value, 0);
}

/** Canonical form as bytes, which is what actually gets hashed and signed. */
export function canonicalUtf8(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalise(value));
}

function write(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) {
    throw new CanonicalisationError('value nested too deeply');
  }
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalisationError(`cannot canonicalise ${String(value)}`);
      }
      // `JSON.stringify` already emits the ECMAScript number-to-string form
      // RFC 8785 specifies. `-0` is the one exception it gets wrong for us.
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'undefined':
    case 'function':
    case 'symbol':
      throw new CanonicalisationError(`cannot canonicalise ${typeof value}`);
    case 'bigint':
      throw new CanonicalisationError('cannot canonicalise bigint');
  }

  if (Array.isArray(value)) {
    return `[${value.map((v) => write(v, depth + 1)).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  // Sorted by UTF-16 code unit, which is what the RFC specifies and what a
  // plain `<` comparison does. A locale-aware compare here would be a
  // "helpful" change that invalidates every signature on a differently
  // configured host.
  const keys = Object.keys(obj).sort();
  const parts: string[] = [];
  for (const key of keys) {
    parts.push(`${JSON.stringify(key)}:${write(obj[key], depth + 1)}`);
  }
  return `{${parts.join(',')}}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proofs
// ─────────────────────────────────────────────────────────────────────────────

export const PROOF_TYPE = 'DataIntegrityProof';
export const CRYPTOSUITE = 'eddsa-jcs-2022';

export interface ProofConfig {
  type: string;
  cryptosuite: string;
  created: string;
  verificationMethod: string;
  proofPurpose: 'assertionMethod';
}

export function proofConfigFor(did: string, created: Date): ProofConfig {
  return {
    type: PROOF_TYPE,
    cryptosuite: CRYPTOSUITE,
    created: created.toISOString(),
    verificationMethod: `${did}#${did.slice('did:key:'.length)}`,
    proofPurpose: 'assertionMethod',
  };
}

/**
 * The bytes a proof signs: the hash of its own configuration, then the hash of
 * the document, in that order.
 *
 * Takes the two hashes rather than computing them, so it works unchanged for a
 * synchronous Node digest and an asynchronous WebCrypto one. What is shared is
 * the part that must agree — the order, and that it is a concatenation of two
 * digests rather than a digest of a concatenation. Hashing itself stays with
 * whoever is doing it.
 *
 * Covering the configuration is what stops a proof being lifted onto another
 * document or backdated: `created` and `verificationMethod` are inside the
 * signature, not beside it.
 */
export function composeSigningInput(
  proofConfigHash: Uint8Array,
  documentHash: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(proofConfigHash.length + documentHash.length);
  out.set(proofConfigHash, 0);
  out.set(documentHash, proofConfigHash.length);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// did:key
// ─────────────────────────────────────────────────────────────────────────────

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ED25519_MULTICODEC = Uint8Array.from([0xed, 0x01]);

export function base58btcEncode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  // Leading zero bytes carry no value but are part of the identifier, so each
  // one is written explicitly. Dropping them silently shortens a key.
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out || '1';
}

export function base58btcDecode(text: string): Uint8Array {
  // O(n²) in the input (a growing BigInt, multiplied per character), so it is
  // bounded before it runs: a did:key for Ed25519 is 47 base58 characters, and
  // this decodes a peer- or file-supplied string. See the server copy in
  // `apps/api/utils/federation/did.ts` for the measured cost of not capping it.
  if (text.length > 64) throw new Error('base58btc string too long');
  let n = 0n;
  for (const ch of text) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`not base58btc: ${ch}`);
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const ch of text) {
    if (ch !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** `did:key:z…` for a raw 32-byte Ed25519 public key. */
export function didKeyFromRaw(raw: Uint8Array): string {
  if (raw.length !== 32) {
    throw new Error(`expected a 32-byte Ed25519 key, got ${raw.length}`);
  }
  const tagged = new Uint8Array(ED25519_MULTICODEC.length + raw.length);
  tagged.set(ED25519_MULTICODEC, 0);
  tagged.set(raw, ED25519_MULTICODEC.length);
  return `did:key:z${base58btcEncode(tagged)}`;
}

/** The raw public key inside a `did:key`, or throws. */
export function rawFromDidKey(did: string): Uint8Array {
  if (!did.startsWith('did:key:z')) throw new Error('not a did:key');
  const tagged = base58btcDecode(did.slice('did:key:z'.length));
  if (tagged[0] !== 0xed || tagged[1] !== 0x01) {
    throw new Error('not an Ed25519 did:key');
  }
  return tagged.subarray(2);
}
