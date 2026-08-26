import { describe, expect, it } from 'vitest';
import { normalizePrefix, resolveObjectKey } from '../utils/storage/keys';

// The one piece of the storage abstraction that is load-bearing for security.
//
// `resolveObjectKey` sits between an untrusted `/uploads/...` URL and two very
// different backends. On a filesystem a mistake here is a classic traversal;
// on S3 it is a prefix escape, and the escape happens in a place that is easy
// to miss — `fetch()` collapses `..` in the URL before the request leaves the
// process, so a key the S3 server would have treated as an opaque string
// becomes a real path segment on the wire.
//
// Both drivers therefore refuse to address anything this function did not
// bless, and the drivers re-check containment on top (realpath for the
// filesystem, an origin/prefix assertion for S3).

describe('resolveObjectKey — traversal', () => {
  it('rejects a parent-directory segment', () => {
    for (const attempt of [
      '..',
      '../secrets',
      '../../etc/passwd',
      'a/../../etc/passwd',
      'logo.png/../../../etc/shadow',
      'uploads/../../root/.ssh/id_rsa',
    ]) {
      expect(resolveObjectKey(attempt), attempt).toBeNull();
    }
  });

  it('rejects a parent-directory segment written with backslashes', () => {
    // A check that only knows about `/` lets these through, and the
    // filesystem driver would resolve them on a Windows host. Backslash is a
    // legal S3 key character, which is exactly what makes it a good smuggling
    // vehicle — so it is treated as a separator here, not as content.
    for (const attempt of [
      '..\\secrets',
      '..\\..\\windows\\win.ini',
      'a\\..\\..\\b',
      '..\\/etc/passwd',
    ]) {
      expect(resolveObjectKey(attempt), attempt).toBeNull();
    }
  });

  it('does not let an absolute path rebase the key', () => {
    // `path.resolve(base, '/etc/passwd')` returns `/etc/passwd` — the second
    // argument wins and the base is discarded. Stripping the leading
    // separator is what stops that, and it must hold for the S3 driver too,
    // where a leading `/` would produce a double slash and address a
    // different object than the filesystem driver does.
    expect(resolveObjectKey('/etc/passwd')).toBe('etc/passwd');
    expect(resolveObjectKey('//etc//passwd')).toBe('etc/passwd');
    expect(resolveObjectKey('\\etc\\passwd')).toBe('etc/passwd');
  });

  it('does not decode, so it cannot be tricked into decoding twice', () => {
    // h3 decodes the path before routing, so what arrives here is already
    // decoded once — `%2e%2e` reaches a route param as `..` and is caught by
    // the case above. Decoding AGAIN here is what would turn `%252e%252e`
    // into a live `..`, so this function treats a stray `%2e` as the four
    // ordinary characters it is.
    expect(resolveObjectKey('%2e%2e%2fetc%2fpasswd')).toBe(
      '%2e%2e%2fetc%2fpasswd'
    );
    expect(resolveObjectKey('%252e%252e/passwd')).toBe('%252e%252e/passwd');
  });

  it('rejects control characters', () => {
    // A NUL truncates the path in the C layer under the filesystem driver:
    // `logo.png\u0000.txt` would open `logo.png` on some runtimes.
    expect(resolveObjectKey('logo.png\u0000.txt')).toBeNull();
    expect(resolveObjectKey('logo\n.png')).toBeNull();
    expect(resolveObjectKey('logo\u007f.png')).toBeNull();
  });

  it('rejects nothing-shaped input', () => {
    for (const attempt of ['', '.', './', '/', '//', '///', '\\', './././']) {
      expect(resolveObjectKey(attempt), JSON.stringify(attempt)).toBeNull();
    }
  });

  it('bounds the length and the nesting depth', () => {
    expect(resolveObjectKey('a'.repeat(513))).toBeNull();
    expect(resolveObjectKey(`${'a'.repeat(201)}.png`)).toBeNull();
    expect(resolveObjectKey(Array(17).fill('a').join('/'))).toBeNull();
    expect(resolveObjectKey(Array(16).fill('a').join('/'))).not.toBeNull();
  });
});

describe('resolveObjectKey — normalisation', () => {
  it('passes through the filenames the upload routes actually generate', () => {
    for (const name of [
      'logo-0123456789abcdef.png',
      'favicon-fedcba9876543210.ico',
      'logo-aabbccddeeff0011.svg',
    ]) {
      expect(resolveObjectKey(name)).toBe(name);
    }
  });

  it('maps every spelling of one path to one key', () => {
    // This is what keeps the two drivers addressing the same object: whatever
    // shape the URL arrives in, the filesystem path and the S3 key are built
    // from the same canonical string.
    for (const spelling of [
      'logo.png',
      '/logo.png',
      './logo.png',
      '//logo.png',
      '\\logo.png',
    ]) {
      expect(resolveObjectKey(spelling), spelling).toBe('logo.png');
    }
  });

  it('keeps legitimate nesting', () => {
    expect(resolveObjectKey('avatars/42/photo.webp')).toBe(
      'avatars/42/photo.webp'
    );
    expect(resolveObjectKey('/avatars//42/./photo.webp')).toBe(
      'avatars/42/photo.webp'
    );
  });

  it('keeps a filename that merely starts with dots', () => {
    // `...` and `..foo` are ordinary names. Only an exact `..` segment is a
    // traversal, and over-rejecting would quietly 400 real files.
    expect(resolveObjectKey('...png')).toBe('...png');
    expect(resolveObjectKey('..foo/bar')).toBe('..foo/bar');
    expect(resolveObjectKey('a/.../b')).toBe('a/.../b');
  });
});

describe('normalizePrefix', () => {
  it('produces exactly one trailing slash, or nothing', () => {
    expect(normalizePrefix(undefined)).toBe('');
    expect(normalizePrefix('')).toBe('');
    expect(normalizePrefix('/')).toBe('');
    expect(normalizePrefix('uploads')).toBe('uploads/');
    expect(normalizePrefix('/uploads')).toBe('uploads/');
    expect(normalizePrefix('uploads/')).toBe('uploads/');
    expect(normalizePrefix('/uploads///')).toBe('uploads/');
    expect(normalizePrefix('a/b')).toBe('a/b/');
  });

  it('refuses a prefix that could escape at the wire', () => {
    // Operator configuration rather than user input, but a `..` here is
    // collapsed by URL parsing exactly like one in a key — better to refuse
    // to start than to silently write outside the intended prefix.
    expect(() => normalizePrefix('../other')).toThrow(/must not contain/);
    expect(() => normalizePrefix('uploads/../other')).toThrow(/must not contain/);
    expect(() => normalizePrefix('./uploads')).toThrow(/must not contain/);
  });
});
