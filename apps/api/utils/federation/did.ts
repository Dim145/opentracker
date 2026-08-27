/**
 * `did:key` for Ed25519, and the base58btc it is spelled in.
 *
 * An instance already identifies itself by a public-key fingerprint, which is
 * `did:key` in all but notation. Writing it properly buys three things that the
 * bespoke fingerprint cannot:
 *
 * - **The key travels with the name.** A `did:key` IS the public key, encoded.
 *   Anybody holding a record can verify it without asking anybody where the
 *   signer's key lives — no directory, no lookup, no availability requirement.
 *   That is precisely what lets a record be relayed by a third party.
 * - **It is the identifier the rest of the ecosystem uses**, so a signature
 *   suite like `eddsa-jcs-2022` slots in without translation.
 * - **It is what an identity can be built on later** — an uploader's DID is the
 *   same shape as an instance's.
 *
 * Base58btc is here because the multibase `z` prefix mandates it. It is a poor
 * encoding by every measure except the one that matters: it is the one the
 * specification names.
 */
import { createPublicKey, type KeyObject } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE = 58n;

/** Multicodec prefix for an Ed25519 public key: varint 0xed01. */
const ED25519_MULTICODEC = Uint8Array.from([0xed, 0x01]);

export class DidError extends Error {}

export function base58btcEncode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);

  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % BASE)] + out;
    n /= BASE;
  }
  // Base58 loses leading zero bytes to the arithmetic; the encoding restores
  // them as leading '1's, one per zero byte.
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

/**
 * A did:key for an Ed25519 key is 2 multicodec bytes + 32 key bytes = 34,
 * which base58btc-encodes to 47 characters. 64 is generous headroom and still
 * a hard ceiling — because the decode below is O(n²) in the input length (a
 * growing BigInt multiplied per character), and this runs on a peer-supplied
 * `verificationMethod` BEFORE any signature is checked. Measured: 128 KB of
 * base58 is 13 s of blocked event loop, 500 KB is nearly 5 minutes, on a
 * single-threaded runtime that stops serving everything else meanwhile. The
 * cap makes the whole class of input free.
 */
const MAX_BASE58_LENGTH = 64;

export function base58btcDecode(text: string): Uint8Array {
  if (text.length === 0) return new Uint8Array();
  if (text.length > MAX_BASE58_LENGTH) {
    throw new DidError('base58 string too long to be a did:key');
  }

  let n = 0n;
  for (const ch of text) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new DidError(`invalid base58 character: ${ch}`);
    n = n * BASE + BigInt(idx);
  }

  const digits: number[] = [];
  while (n > 0n) {
    digits.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const ch of text) {
    if (ch !== '1') break;
    digits.unshift(0);
  }
  return Uint8Array.from(digits);
}

/** The raw 32 bytes of an Ed25519 public key, from a PEM. */
export function rawPublicKey(publicKeyPem: string): Uint8Array {
  const jwk = createPublicKey(publicKeyPem).export({ format: 'jwk' }) as {
    kty?: string;
    crv?: string;
    x?: string;
  };
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) {
    throw new DidError('not an Ed25519 public key');
  }
  return new Uint8Array(Buffer.from(jwk.x, 'base64url'));
}

/** `did:key:z…` for an Ed25519 public key given as PEM. */
export function didKeyFromPublicKey(publicKeyPem: string): string {
  const raw = rawPublicKey(publicKeyPem);
  const prefixed = new Uint8Array(ED25519_MULTICODEC.length + raw.length);
  prefixed.set(ED25519_MULTICODEC, 0);
  prefixed.set(raw, ED25519_MULTICODEC.length);
  return `did:key:z${base58btcEncode(prefixed)}`;
}

/**
 * The other direction — the whole point of the format.
 *
 * A verifier holding only a record and its `did:key` can reconstruct the key
 * and check the signature. Nothing has to be online for that to work, which is
 * what makes relaying safe.
 */
export function publicKeyFromDidKey(did: string): KeyObject {
  const method = 'did:key:z';
  if (!did.startsWith(method)) {
    throw new DidError('not a did:key with base58btc encoding');
  }
  const decoded = base58btcDecode(did.slice(method.length));
  if (
    decoded.length !== ED25519_MULTICODEC.length + 32 ||
    decoded[0] !== ED25519_MULTICODEC[0] ||
    decoded[1] !== ED25519_MULTICODEC[1]
  ) {
    throw new DidError('did:key does not encode an Ed25519 public key');
  }
  const raw = decoded.slice(ED25519_MULTICODEC.length);
  return createPublicKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(raw).toString('base64url'),
    },
    format: 'jwk',
  });
}

/**
 * The verification method a proof points at. For `did:key` the key and the
 * document are the same thing, so the fragment repeats the identifier — which
 * looks redundant and is what the specification says.
 */
export function verificationMethodFor(did: string): string {
  return `${did}#${did.slice('did:key:'.length)}`;
}

/** The DID a verification method belongs to. */
export function didFromVerificationMethod(vm: string): string {
  const hash = vm.indexOf('#');
  return hash === -1 ? vm : vm.slice(0, hash);
}
