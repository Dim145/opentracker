/**
 * Content signature — fingerprint of a `.torrent` based on the files
 * it carries (paths + sizes), independent of the `info_hash`.
 *
 * The same content can produce different `info_hash` values depending
 * on piece length, the `private` flag, or any byte that ends up in
 * the `info` dict of the bencoded `.torrent`. Cross-seeding is the
 * legitimate practice of seeding the same files under multiple
 * `.torrent`s. To recognise that situation, we hash a **canonical**
 * representation of the file list and store it alongside the torrent.
 *
 * Canonicalisation rules:
 *   - Single-file torrent → one entry with `{path: name, length}`.
 *   - Multi-file torrent  → one entry per file, taken straight from
 *                           parse-torrent's `files[]`.
 *   - Entries are sorted by `path` (locale-independent — Unicode code
 *     point order via `localeCompare('en', {sensitivity: 'variant'})`
 *     would still give the same result for ASCII paths, but plain `<`
 *     comparison is enough for our hashing input and matches how
 *     external cross-seed tools canonicalise).
 *   - Final string is JSON of the sorted array, hashed with SHA-256
 *     → 64-char lowercase hex digest.
 *
 * Two torrents with the same file paths + the same file sizes share a
 * signature. Two torrents that differ in even a single byte of any
 * file size or path do not. Empty / malformed inputs return `null`
 * so the caller can decide whether to fall back or fail loudly.
 */
import { createHash } from 'node:crypto';

export interface SignatureInput {
  /** Name (single-file) or root folder (multi-file). */
  name?: string;
  /** Total bytes for a single-file torrent. */
  length?: number;
  /** File list for a multi-file torrent. */
  files?: Array<{ path: string; length: number }>;
}

interface CanonicalEntry {
  path: string;
  length: number;
}

function canonicalise(input: SignatureInput): CanonicalEntry[] | null {
  if (input.files && input.files.length > 0) {
    const entries: CanonicalEntry[] = [];
    for (const f of input.files) {
      if (typeof f.path !== 'string' || typeof f.length !== 'number') {
        // A malformed file row would make the signature
        // unreproducible — refuse rather than emit garbage.
        return null;
      }
      entries.push({ path: f.path, length: f.length });
    }
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return entries;
  }
  if (typeof input.name === 'string' && typeof input.length === 'number') {
    return [{ path: input.name, length: input.length }];
  }
  return null;
}

/**
 * Compute the SHA-256 hex digest of a torrent's canonical file list,
 * or `null` if the input is empty / malformed.
 */
export function computeContentSignature(
  input: SignatureInput
): string | null {
  const entries = canonicalise(input);
  if (!entries) return null;
  const canonical = JSON.stringify(entries);
  return createHash('sha256').update(canonical).digest('hex');
}
