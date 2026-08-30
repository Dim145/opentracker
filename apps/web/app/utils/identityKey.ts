/**
 * A key the server never sees.
 *
 * Generated here, kept here, used here. The instance can still say "that
 * identifier is our member Nova" — it cannot say "and here is Nova signing",
 * because it has nothing to sign with. That is the whole of custody, and it is
 * why this file exists rather than an endpoint.
 *
 * ## What it does not buy
 *
 * The instance can still refuse to endorse, and it can still mint a different
 * keypair and endorse THAT as Nova. Custody stops it forging a proof for the
 * key you actually use; it does not stop it inventing a rival you. Somewhere
 * that has already seen your work can tell the two apart — somewhere that has
 * not, cannot. Worth being clear about, because "my instance cannot
 * impersonate me" is what people will assume this bought.
 *
 * ## Byte-for-byte with the server
 *
 * Canonicalisation, the signing-input composition and the `did:key` encoding
 * all come from `@trackarr/shared`, unchanged. Only the hashing and signing are
 * local, because those are WebCrypto's job here and `node:crypto`'s there. A
 * second implementation of any of the shared three would agree today and drift
 * later, and the failure would be a document that verifies on one side only.
 */
import {
  canonicalUtf8,
  composeSigningInput,
  didKeyFromRaw,
  proofConfigFor,
  rawFromDidKey,
} from '@trackarr/shared/didProof';

/** Where the browser keeps it. One key, one member, one origin. */
const STORAGE_KEY = 'trackarr.identity.key';

export interface HeldKey {
  did: string;
  /** PKCS#8, base64 — what a member exports and re-imports. */
  privateKeyB64: string;
  /** SPKI PEM, which is what the server wants for the endorsement. */
  publicKeyPem: string;
}

function toB64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
/*
 * `Uint8Array<ArrayBuffer>`, not the bare alias.
 *
 * Since TypeScript 5.7 `Uint8Array` is generic over its backing buffer and
 * defaults to `ArrayBufferLike`, which includes `SharedArrayBuffer` — and
 * WebCrypto's `BufferSource` does not. Every `crypto.subtle` call taking
 * one of these therefore failed to match an overload. The value here is
 * always backed by a plain `ArrayBuffer`; the annotation just says so.
 */
function fromB64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function pem(spki: ArrayBuffer): string {
  const body = toB64(spki).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

/** Whether this browser can do Ed25519 at all. Checked, never assumed. */
export async function supported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Make a key, and prove possession of it in the same breath.
 *
 * The proof is a signature over the identifier itself, which is derived from
 * the key: self-referential on purpose, so there is nothing to replay it onto.
 * Without it, anybody could register somebody else's public key as their own
 * and have the instance endorse a claim to a key they do not hold.
 */
export async function generate(): Promise<HeldKey & { possession: string }> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

  const rawPublic = new Uint8Array(
    await crypto.subtle.exportKey('raw', pair.publicKey),
  );
  const did = didKeyFromRaw(rawPublic);
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', pair.privateKey);

  const possession = toB64(
    await crypto.subtle.sign(
      { name: 'Ed25519' },
      pair.privateKey,
      new TextEncoder().encode(did),
    ),
  );

  const held: HeldKey = {
    did,
    privateKeyB64: toB64(pkcs8),
    publicKeyPem: pem(spki),
  };
  return { ...held, possession: b64url(possession) };
}

/** The server speaks base64url; `btoa` does not. */
function b64url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function store(key: HeldKey): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(key));
}

export function load(): HeldKey | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HeldKey) : null;
  } catch {
    return null;
  }
}

export function forget(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Complete an endorsed document by adding the subject's proof.
 *
 * The instance signed the same bytes for its half. Both proofs therefore cover
 * the document without either of them, so neither depends on the other having
 * been made first — which is what lets the two halves be produced in two
 * places, minutes and a network apart.
 */
export async function signDocument(
  document: Record<string, unknown>,
  key: HeldKey,
): Promise<Record<string, unknown>> {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    fromB64(key.privateKeyB64),
    { name: 'Ed25519' },
    false,
    ['sign'],
  );

  const { proof: _p, 'trackarr:endorsement': endorsement, ...rest } = document;
  const body = rest as Record<string, unknown>;
  const config = proofConfigFor(key.did, new Date());

  const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const input = composeSigningInput(
    await digest(canonicalUtf8(config)),
    await digest(canonicalUtf8(body)),
  );

  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, input);

  return {
    ...body,
    proof: { ...config, proofValue: `u${b64url(toB64(signature))}` },
    ...(endorsement ? { 'trackarr:endorsement': endorsement } : {}),
  };
}

/** PKCS#8 base64 back to the PEM an export should carry. */
export function toPem(privateKeyB64: string): string {
  const body = privateKeyB64.replace(/(.{64})/g, '$1\n');
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
}

/**
 * Read a downloaded identity file, whatever shape it arrived in.
 *
 * The export nests the identity under `identity`; a file somebody edited by
 * hand, or produced by another tool, may hold it bare. Both name the same key,
 * so both are read. This lives here rather than in the component because it is
 * a decision about a file format, and a decision in a component is a decision
 * nothing tests.
 */
export async function readExportFile(
  parsed: Record<string, unknown>,
): Promise<HeldKey | null> {
  const nested = parsed.identity;
  const source =
    nested && typeof nested === 'object'
      ? (nested as Record<string, unknown>)
      : parsed;
  return fromExport(source);
}

/**
 * Rebuild a held key from an exported file.
 *
 * Verified rather than trusted: the private half is imported and used to sign
 * a probe, and the signature is checked against the public half the file
 * claims. A file whose two halves do not belong together would otherwise leave
 * a member signing claims that verify against nobody, and they would find out
 * on the far side of a move.
 */
export async function fromExport(
  source: Record<string, unknown>,
): Promise<HeldKey | null> {
  const did = typeof source.did === 'string' ? source.did : null;
  const pem = typeof source.privateKeyPem === 'string' ? source.privateKeyPem : null;
  const publicKeyPem =
    typeof source.publicKeyPem === 'string' ? source.publicKeyPem : null;
  if (!did || !pem || !publicKeyPem) return null;

  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  try {
    const priv = await crypto.subtle.importKey(
      'pkcs8',
      fromB64(b64),
      { name: 'Ed25519' },
      false,
      ['sign'],
    );
    // The identifier IS the public key, so deriving it back from the file and
    // comparing is what proves the two halves belong together.
    const raw = rawFromDidKey(did);
    const pub = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, [
      'verify',
    ]);
    const probe = new TextEncoder().encode(did);
    const sig = await crypto.subtle.sign({ name: 'Ed25519' }, priv, probe);
    if (!(await crypto.subtle.verify({ name: 'Ed25519' }, pub, sig, probe))) {
      return null;
    }
    return { did, privateKeyB64: b64, publicKeyPem };
  } catch {
    return null;
  }
}
