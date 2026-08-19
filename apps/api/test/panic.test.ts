import { describe, it, expect } from 'vitest';
import { randomBytes, createCipheriv } from 'node:crypto';
import {
  deriveKey,
  encrypt,
  decrypt,
  generateSalt,
  encryptField,
  decryptField,
} from '../utils/panic';

// Panic-mode encryption. This module is the project's only use of AES-GCM, and
// it serves two paths: sealing the database, and the notification channel
// secrets (`channelSecrets.ts`), which run all the time. A regression here does
// not break a screen, it makes data unreadable — with no usable error message,
// since GCM fails exactly the way a wrong key does.
//
// The main concern in the cases below is the authentication tag length.
// Without `authTagLength`, Node accepts GCM tags of 4, 8, 12, 13, 14, 15 or 16
// bytes; since the tag comes from the string stored in the database, an
// attacker able to write there could truncate it and bring the cost of a
// forgery down from 2^128 to 2^32. With GCM, a successful forgery on a short
// tag leaks the authentication subkey H and opens the door to arbitrary
// forgeries — exactly the scenario panic mode exists to cover. Hence the two
// "truncated tag" tests.

const PASSWORD = 'a-perfectly-valid-panic-password';

async function key(): Promise<Buffer> {
  return deriveKey(PASSWORD, Buffer.from(generateSalt(), 'base64'));
}

describe('deriveKey / generateSalt', () => {
  it('derives a 32-byte AES-256 key', async () => {
    const k = await key();
    expect(k).toBeInstanceOf(Buffer);
    expect(k.length).toBe(32);
  });

  it('is deterministic for a constant salt, and diverges otherwise', async () => {
    const salt = Buffer.from(generateSalt(), 'base64');
    const a = await deriveKey(PASSWORD, salt);
    const b = await deriveKey(PASSWORD, salt);
    const c = await deriveKey(PASSWORD, Buffer.from(generateSalt(), 'base64'));
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('produces a 32-byte salt, different on every call', () => {
    const s1 = Buffer.from(generateSalt(), 'base64');
    const s2 = Buffer.from(generateSalt(), 'base64');
    expect(s1.length).toBe(32);
    expect(s1.equals(s2)).toBe(false);
  });
});

describe('encrypt / decrypt', () => {
  it('round-trips faithfully, non-ASCII UTF-8 included', async () => {
    const k = await key();
    for (const clear of [
      'a',
      '',
      'https://hooks.example.org/T00/B01/xoxb-secret',
      'accentué — ﬁchier « clé » 日本語 🎬',
      'x'.repeat(10_000),
    ]) {
      expect(decrypt(encrypt(clear, k), k)).toBe(clear);
    }
  });

  it('emits `iv:ct:tag` with a 12-byte IV and a 16-byte tag', async () => {
    const k = await key();
    const parts = encrypt('payload', k).split(':');
    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[0]!, 'base64').length).toBe(12);
    // 16 bytes: Node's GCM default, and what `authTagLength` now enforces on
    // decryption. If this test falls, every already-stored value becomes
    // unreadable — this is the guard rail on that fix.
    expect(Buffer.from(parts[2]!, 'base64').length).toBe(16);
  });

  it('uses a fresh IV every call, so two ciphertexts of the same plaintext differ', async () => {
    const k = await key();
    expect(encrypt('same text', k)).not.toBe(encrypt('same text', k));
  });

  it('refuses a different key', async () => {
    const blob = encrypt('secret', await key());
    const other = await key();
    expect(() => decrypt(blob, other)).toThrow();
  });

  it('refuses tampered ciphertext', async () => {
    const k = await key();
    const [iv, ct, tag] = encrypt('secret', k).split(':');
    const bytes = Buffer.from(ct!, 'base64');
    bytes[0] ^= 0xff;
    expect(() => decrypt(`${iv}:${bytes.toString('base64')}:${tag}`, k)).toThrow();
  });

  it('refuses a tampered tag of the right length', async () => {
    const k = await key();
    const [iv, ct, tag] = encrypt('secret', k).split(':');
    const bytes = Buffer.from(tag!, 'base64');
    bytes[0] ^= 0x01;
    expect(() => decrypt(`${iv}:${ct}:${bytes.toString('base64')}`, k)).toThrow();
  });

  it('refuses a TRUNCATED tag instead of accepting it', async () => {
    const k = await key();
    const [iv, ct, tag] = encrypt('secret', k).split(':');
    // Without `authTagLength`, Node accepted these lengths and merely checked
    // the leading bytes — the hole this fix closes.
    for (const n of [4, 8, 12, 15]) {
      const short = Buffer.from(tag!, 'base64').subarray(0, n).toString('base64');
      expect(() => decrypt(`${iv}:${ct}:${short}`, k)).toThrow();
    }
  });

  it('refuses a malformed shape', async () => {
    const k = await key();
    for (const bad of ['', 'noseparator', 'a:b:c:d']) {
      expect(() => decrypt(bad, k)).toThrow();
    }
  });
});

describe('legacy `ct:tag` format', () => {
  // The earliest versions stored a global 16-byte IV separately. Restore must
  // keep reading those rows, otherwise a database sealed before the migration
  // becomes permanently unreadable.
  function encryptLegacy(text: string, k: Buffer, iv: Buffer): string {
    const cipher = createCipheriv('aes-256-gcm', k, iv);
    let out = cipher.update(text, 'utf8', 'base64');
    out += cipher.final('base64');
    return `${out}:${cipher.getAuthTag().toString('base64')}`;
  }

  it('decrypts a two-part pair when the legacy IV is supplied', async () => {
    const k = await key();
    const legacyIv = randomBytes(16);
    const blob = encryptLegacy('old data', k, legacyIv);
    expect(decrypt(blob, k, legacyIv)).toBe('old data');
  });

  it('refuses two parts with no legacy IV rather than guessing', async () => {
    const k = await key();
    const blob = encryptLegacy('old data', k, randomBytes(16));
    expect(() => decrypt(blob, k)).toThrow(/Malformed/);
  });
});

describe('encryptField / decryptField', () => {
  it('passes null and undefined through without encrypting them', async () => {
    const k = await key();
    expect(encryptField(null, k)).toBeNull();
    expect(encryptField(undefined, k)).toBeNull();
    expect(decryptField(null, k)).toBeNull();
  });

  it('round-trips a present value, the empty string included', async () => {
    const k = await key();
    for (const v of ['', 'value', '0']) {
      expect(decryptField(encryptField(v, k), k)).toBe(v);
    }
  });
});
