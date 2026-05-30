/**
 * Ed25519 identity primitives for federation server-to-server auth.
 *
 * Each instance owns ONE keypair, generated the first time the owner
 * enables federation (see `config.ts`). The public key is shared in the
 * clear during the handshake; the private key is encrypted at rest with
 * the same AES-GCM helper as notification-channel secrets.
 *
 * The `instanceId` is a deterministic fingerprint of the public key —
 * it doubles as the `keyId` a partner uses to look this instance up, so
 * it can never drift from the key it names. No PKI, no central CA: trust
 * is established once, out-of-band, when an owner approves a handshake
 * (they verify `shortFingerprint` against what the partner tells them).
 *
 * Ed25519 (not RSA): tiny keys, tiny signatures, fast verify on the hot
 * inbound path, and `sign(null, …)` needs no separate hash step.
 */
import {
  generateKeyPairSync,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
} from 'node:crypto';

export interface GeneratedKeypair {
  instanceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

/** SPKI DER bytes of a public key — the stable input both fingerprints
 *  hash over. Throws on a malformed PEM (caller treats as untrusted). */
function spkiDer(publicKeyPem: string): Buffer {
  return createPublicKey(publicKeyPem).export({
    type: 'spki',
    format: 'der',
  }) as Buffer;
}

/**
 * `tk_` + base64url(sha256(SPKI)) truncated to 20 chars. Deterministic
 * and collision-resistant for the scale of a federation allow-list.
 * This is the public identity advertised in the handshake.
 */
export function computeInstanceId(publicKeyPem: string): string {
  return (
    'tk_' +
    createHash('sha256').update(spkiDer(publicKeyPem)).digest('base64url').slice(0, 20)
  );
}

/**
 * Short, human-verifiable fingerprint (e.g. `8E·44·A2`) an owner reads
 * out-of-band before approving a handshake. Last 3 bytes of the SHA-256
 * over the SPKI, hex, grouped — short enough to say over the phone,
 * long enough to make impersonation impractical for a manual approval.
 */
export function shortFingerprint(publicKeyPem: string): string {
  const hex = createHash('sha256').update(spkiDer(publicKeyPem)).digest('hex').toUpperCase();
  return `${hex.slice(-6, -4)}·${hex.slice(-4, -2)}·${hex.slice(-2)}`;
}

/** Generate a fresh instance identity. */
export function generateInstanceKeypair(): GeneratedKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  return {
    instanceId: computeInstanceId(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
  };
}

/** Ed25519 sign of arbitrary bytes → base64 signature. */
export function signPayload(privateKeyPem: string, data: string | Buffer): string {
  const key = createPrivateKey(privateKeyPem);
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return cryptoSign(null, buf, key).toString('base64');
}

/**
 * Ed25519 verify. Returns `false` on ANY malformed input (bad PEM, bad
 * base64, length mismatch) rather than throwing — callers on the inbound
 * path treat a non-true result as "reject", never as a 500.
 */
export function verifyPayload(
  publicKeyPem: string,
  data: string | Buffer,
  signatureB64: string,
): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    return cryptoVerify(null, buf, key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}
