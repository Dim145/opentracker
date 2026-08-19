/**
 * At-rest encryption for the two account secrets a database dump would
 * otherwise turn straight into account takeover.
 *
 * `users.auth_verifier` is the login credential itself, not a hash of it.
 * The login handshake computes `SHA256(auth_verifier ‖ challenge)` from the
 * value it reads out of the row, so whoever can read that column can forge
 * the proof for any challenge, for any account, with no cracking step. That
 * is the pass-the-hash property of a challenge-response built on top of a
 * stored digest; real SRP-6a does not share it, because the server's `v` is
 * useless without the discrete log.
 *
 * `users.totp_secret` used to be stored in the clear on the reasoning that
 * "the secret is useless without an active session, since the handshake
 * gates the account". That reasoning only holds while the handshake is an
 * independent barrier — and it is not, because the same dump that yields the
 * TOTP seed also yields the verifier that *is* the barrier. Both factors sat
 * in one table, both directly usable.
 *
 * Encrypting both here does not fix the protocol (see doc: SRP-6a / OPAQUE
 * remains the root fix for the verifier). It changes the requirement from
 * "read the database" to "read the database AND hold the key", and the key
 * lives in the environment, not in the dump — which is the bar every other
 * secret in this codebase already clears.
 *
 * Key separation: the KDF salt differs from `channelSecrets.ts`, so a
 * channel-key compromise does not unlock credentials and vice versa, even
 * though both derive from the same root secret by default.
 *
 * Reads are transparently backward compatible: a value that is not in our
 * `iv:ct:tag` shape is returned as-is (legacy plaintext) and gets encrypted
 * the next time it is written; the login handler additionally upgrades the
 * row in place once a proof has been verified.
 */
import { createHmac, scryptSync } from 'crypto';
import { encrypt, decrypt } from './panic';

let cachedKeys: { current: Buffer; previous: Buffer | null } | null = null;

function salt(): string {
  return process.env.CREDENTIAL_ENCRYPTION_SALT || 'trackarr:credentials:v1';
}

function derive(raw: string, where: string): Buffer {
  if (raw.length < 32) {
    throw new Error(
      `[credentialSecrets] ${where} must be at least 32 characters. Generate one with \`openssl rand -hex 32\`.`,
    );
  }
  return scryptSync(raw, salt(), 32) as Buffer;
}

/** True when the key was inherited rather than set for this purpose. */
export function usingInheritedKey(): boolean {
  return !process.env.CREDENTIAL_ENCRYPTION_KEY;
}

function getKeys(): { current: Buffer; previous: Buffer | null } {
  if (cachedKeys) return cachedKeys;
  const raw =
    process.env.CREDENTIAL_ENCRYPTION_KEY ||
    process.env.CHANNEL_ENCRYPTION_KEY ||
    process.env.NUXT_SESSION_SECRET;
  if (!raw) {
    throw new Error(
      '[credentialSecrets] No CREDENTIAL_ENCRYPTION_KEY / CHANNEL_ENCRYPTION_KEY / NUXT_SESSION_SECRET set; refusing to handle account secrets. Generate one with `openssl rand -hex 32`.',
    );
  }
  // A rotation key. Without it, changing the root secret is a one-way door:
  // every verifier and TOTP seed becomes undecryptable and the whole member
  // base is locked out with no way back. Set this to the OLD value for one
  // deployment; rows re-encrypt under the new key as their owners log in.
  const prev = process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS;
  cachedKeys = {
    current: derive(raw, 'The credential encryption key'),
    previous: prev ? derive(prev, 'CREDENTIAL_ENCRYPTION_KEY_PREVIOUS') : null,
  };
  return cachedKeys;
}

function getKey(): Buffer {
  return getKeys().current;
}

/**
 * Key check value — a short, non-reversible fingerprint of the derived key.
 *
 * Persisted on first use so a later boot can tell "the key changed" from
 * "everything is fine". Without it, rotating `NUXT_SESSION_SECRET` — which
 * before this feature only invalidated session cookies, and which a careful
 * operator does periodically — would silently make every credential
 * undecryptable, and the only symptom would be every member being told
 * "Invalid credentials" at once.
 */
export function keyCheckValue(): string {
  return createHmac('sha256', getKey())
    .update('trackarr:credential-kcv:v1')
    .digest('base64')
    .slice(0, 22);
}

/**
 * `iv:ct:tag`, three base64 fields. Neither a verifier (base64 of 32 bytes,
 * no colon) nor a TOTP seed (base32, no colon) can collide with this shape,
 * so it is a safe discriminator between "already encrypted" and "legacy
 * plaintext".
 */
const ENCRYPTED_SHAPE = /^[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}:[A-Za-z0-9+/]+={0,2}$/;

export function looksEncrypted(value: string | null | undefined): boolean {
  return !!value && ENCRYPTED_SHAPE.test(value);
}

/** Encrypt a secret for storage. `null`/empty round-trip untouched. */
export function encryptSecret(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  return encrypt(value, getKey());
}

/**
 * Decrypt a stored secret.
 *
 * A value that is not in our shape is assumed to be legacy plaintext and is
 * returned unchanged, so an existing deployment keeps working through the
 * rollout without a migration window. Returns `null` when the ciphertext
 * fails authentication — the caller must treat that as "no secret" and fail
 * closed rather than fall back to a raw comparison.
 */
export function decryptSecret(
  value: string | null | undefined,
): string | null {
  if (value == null || value === '') return null;
  if (!looksEncrypted(value)) return value; // legacy plaintext
  const { current, previous } = getKeys();
  try {
    return decrypt(value, current);
  } catch {
    /* fall through to the rotation key */
  }
  if (previous) {
    try {
      return decrypt(value, previous);
    } catch {
      /* fall through to the failure below */
    }
  }
  // Wrong key, rotated salt, or tampering. Never fall through to the raw
  // value: that would let a corrupted row authenticate against itself.
  console.error(
    '[credentialSecrets] Could not decrypt a stored account secret. The encryption key changed without CREDENTIAL_ENCRYPTION_KEY_PREVIOUS being set, or CREDENTIAL_ENCRYPTION_SALT was altered.',
  );
  return null;
}

/**
 * True when the stored value should be written back under the current key:
 * either it is legacy plaintext, or it only decrypts under the rotation key.
 * Callers do this on a proven login, which is the safe moment.
 */
export function needsRewrite(value: string | null | undefined): boolean {
  if (!value) return false;
  if (!looksEncrypted(value)) return true;
  try {
    decrypt(value, getKeys().current);
    return false;
  } catch {
    return true;
  }
}

/**
 * Same as `encryptSecret` for a column declared NOT NULL. Throws rather than
 * returning null so a caller can never write an empty credential by accident.
 */
export function encryptSecretRequired(value: string): string {
  const out = encryptSecret(value);
  if (!out) {
    throw new Error('[credentialSecrets] Refusing to store an empty secret.');
  }
  return out;
}

/** Surfaces a misconfigured deployment at boot rather than at first login. */
export function assertCredentialEncryptionReady(): void {
  getKey();
}
