import { describe, it, expect } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  encryptSecretRequired,
  looksEncrypted,
} from '../utils/credentialSecrets';

// At-rest encryption of the two account secrets — the login verifier and the
// TOTP seed.
//
// The property under test is narrow but load-bearing: a stored value must be
// unusable without the key, and a value written before the feature existed
// must keep working. Those two pull in opposite directions, which is exactly
// where a subtle mistake would live — a shape test that is too loose lets a
// legacy plaintext be mistaken for ciphertext (locking every account out), one
// that is too tight lets a real ciphertext be handed back raw (which would
// then be compared against itself and authenticate anyone).

describe('round trip', () => {
  it('returns the original value', () => {
    for (const secret of [
      'a',
      'JBSWY3DPEHPK3PXP', // base32 TOTP seed
      Buffer.alloc(32, 7).toString('base64'), // verifier shape
      'accentué — 日本語 🎬',
      'x'.repeat(5000),
    ]) {
      expect(decryptSecret(encryptSecret(secret))).toBe(secret);
    }
  });

  it('produces a different ciphertext every time', () => {
    // A fresh IV per record: two accounts with the same password must not
    // present the same stored verifier, or the column becomes a rainbow table
    // of its own.
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('does not leak the plaintext into the ciphertext', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(encryptSecret(secret)).not.toContain(secret);
  });
});

describe('shape discrimination', () => {
  it('recognises its own output', () => {
    expect(looksEncrypted(encryptSecret('x'))).toBe(true);
  });

  it('does not mistake a verifier or a TOTP seed for ciphertext', () => {
    // Both are colon-free, which is what makes the discriminator safe.
    expect(looksEncrypted(Buffer.alloc(32, 1).toString('base64'))).toBe(false);
    expect(looksEncrypted('JBSWY3DPEHPK3PXP')).toBe(false);
    expect(looksEncrypted('')).toBe(false);
    expect(looksEncrypted(null)).toBe(false);
  });
});

describe('backward compatibility', () => {
  it('hands a legacy plaintext back unchanged', () => {
    // Accounts created before the rollout must keep logging in; the value is
    // upgraded in place on the next proven login.
    const legacy = Buffer.alloc(32, 3).toString('base64');
    expect(decryptSecret(legacy)).toBe(legacy);
  });

  it('treats absent values as absent', () => {
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret('')).toBeNull();
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret('')).toBeNull();
  });
});

describe('failure is closed, not open', () => {
  it('returns null on a tampered ciphertext rather than the raw value', () => {
    // The dangerous failure mode: handing the stored string back on a
    // decryption error. The caller compares the returned value against a proof
    // derived from it, so a raw fall-through would let a corrupted row
    // authenticate against itself.
    const [iv, ct, tag] = encryptSecret('secret')!.split(':');
    const bytes = Buffer.from(ct!, 'base64');
    bytes[0] ^= 0xff;
    const tampered = `${iv}:${bytes.toString('base64')}:${tag}`;
    expect(decryptSecret(tampered)).toBeNull();
    expect(decryptSecret(tampered)).not.toBe(tampered);
  });

  it('refuses to store an empty secret on a NOT NULL column', () => {
    expect(() => encryptSecretRequired('')).toThrow();
  });
});
