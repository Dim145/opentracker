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
 *
 * ⚠️ METADATA-ONLY — NOT an integrity proof. By design this fingerprint
 * excludes `info.pieces` (the only field that binds a torrent to
 * specific file *bytes*), because cross-seeding the same content with
 * a different piece length legitimately changes `pieces`. The flip
 * side: two torrents with identical file NAMES + SIZES but completely
 * different real content collide here. So the signature must be
 * treated as a "these look like the same release" HINT for cross-seed
 * discovery, never as evidence that a sibling actually holds the same
 * data. Consumers (the cross-seed UI/stats) must not present a
 * signature match as content identity, and must require accepted
 * moderation before showing an uploader-controlled sibling. (Folding
 * `pieces` in would defeat cross-seed entirely, so we deliberately
 * don't.) Paths are NFC-normalised and lengths are range-checked
 * below so the canonical form is stable and can't be poisoned with
 * out-of-range sizes.
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

// Length must be a non-negative safe integer. A negative / NaN /
// >2^53 length (bencode accepts all of these from attacker bytes)
// would make the canonical form meaningless — refuse to sign it.
function validLength(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

// NFC so the same logical path composed differently (e.g. "é" as
// U+00E9 vs "e"+U+0301 on a different OS) yields ONE canonical form,
// instead of two torrents of the same release failing to group.
function normPath(p: string): string {
  return p.normalize('NFC');
}

function canonicalise(input: SignatureInput): CanonicalEntry[] | null {
  if (input.files && input.files.length > 0) {
    const entries: CanonicalEntry[] = [];
    for (const f of input.files) {
      if (typeof f.path !== 'string' || !validLength(f.length)) {
        // A malformed file row would make the signature
        // unreproducible — refuse rather than emit garbage.
        return null;
      }
      entries.push({ path: normPath(f.path), length: f.length });
    }
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return entries;
  }
  if (typeof input.name === 'string' && validLength(input.length)) {
    return [{ path: normPath(input.name), length: input.length }];
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
