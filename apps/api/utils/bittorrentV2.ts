/**
 * BitTorrent v2 (BEP 52) content addressing — the spine that lets two trackers
 * agree on "this file is that file" without trusting each other.
 *
 * ## Why this exists
 *
 * A v1 infohash is the SHA-1 of the whole `info` dict, so piece length, the
 * `private` flag and file ordering all move it: the SAME content has DIFFERENT
 * v1 infohashes on different trackers. `content_signature` (paths + sizes) is our
 * approximation, but it is explicitly a HINT — it excludes the piece bytes, so two
 * releases with identical names and sizes but different bytes collide.
 *
 * BEP 52 addresses each file by the **root of a Merkle tree over its 16 KiB
 * blocks**. That root is a property of the file's *content* alone — independent
 * of piece length, of the `private` flag, of every other file in the torrent. So
 * identical files always produce identical roots, wherever they live. That is the
 * cross-tracker content address v1 could never be.
 *
 * ## What we derive
 *
 * - `infoHashV2` — SHA-256 of the bencoded `info` dict. Still torrent-specific
 *   (it moves with piece length / private), but it is the identifier a v2/hybrid
 *   client announces, which M3 (cross-announce by content) will need.
 * - `contentRootV2` — our release-level cross-tracker key: SHA-256 over the sorted
 *   per-file `(path, merkle root)` pairs. Two uploads of the same release on two
 *   trackers derive the SAME value, because the per-file roots are content-only.
 *   This is the cryptographic upgrade of `content_signature`: same shape, but the
 *   root proves the bytes where the size only guessed them.
 *
 * Padding files (`attr` contains `p`) are excluded — they are piece-alignment
 * filler a tracker adds, not content, so including them would make two identical
 * releases with different padding disagree. Symlinks (no `pieces root`) are
 * skipped for the same reason: they carry no content bytes.
 *
 * A v1-only torrent has no `meta version: 2` and no file tree; this returns
 * `null`, and callers fall back to `content_signature`.
 */
import bencode from 'bencode';
import { createHash } from 'node:crypto';

export interface V2Content {
  /** SHA-256 of the bencoded `info` dict, hex. Torrent-specific (hybrid announce). */
  infoHashV2: string;
  /**
   * The first 20 bytes of `infoHashV2`, hex — what a v2 or hybrid client
   * actually sends to the tracker.
   *
   * BEP 52 keeps the SHA-256 for content addressing but the tracker and DHT
   * protocols were built around 20-byte hashes, so a v2 announce carries the
   * SHA-256 truncated to 20 bytes. That is the value the announce path matches
   * on; it is derived rather than stored, so the two can never disagree.
   */
  infoHashV2Short: string;
  /** Cross-tracker content key over the sorted per-file roots, hex. */
  contentRootV2: string;
  /** Per-file Merkle roots, sorted by path. `root` is '' for a zero-length file. */
  fileRoots: Array<{ path: string; root: string }>;
}

function toStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return Buffer.from(v).toString('latin1');
  return '';
}

/** A file-tree leaf is a node carrying the reserved empty-string key. */
function isLeaf(node: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(node, '');
}

/**
 * Walk the BEP 52 `file tree`, collecting one `(path, root)` per real content
 * file. Returns null the moment a content file is missing a usable root — a
 * torrent we cannot address by content is one we must not pretend we can.
 */
function collectRoots(
  node: Record<string, unknown>,
  prefix: string[],
  out: Array<{ path: string; root: string }>,
): boolean {
  if (isLeaf(node)) {
    // A file node carries ONLY the reserved empty-string key. A node with both
    // `''` and named children is malformed — refusing it (rather than reading it
    // as a file and silently dropping the children) keeps the content address
    // honest about what it covered.
    if (Object.keys(node).length !== 1) return false;
    const meta = node[''] as Record<string, unknown> | undefined;
    if (!meta || typeof meta !== 'object') return false;
    const attr = toStr(meta['attr']);
    // Padding filler: not content, and tracker-dependent — exclude entirely.
    if (attr.includes('p')) return true;
    // Symlink: no bytes of its own — skip without failing the whole torrent.
    if (attr.includes('l') || 'symlink path' in meta) return true;

    const length = meta['length'];
    const rootRaw = meta['pieces root'];
    const path = prefix.join('/').normalize('NFC');
    if (!path) return false;

    if (rootRaw instanceof Uint8Array && rootRaw.length === 32) {
      out.push({ path, root: Buffer.from(rootRaw).toString('hex') });
      return true;
    }
    // A zero-length file legitimately carries no pieces root — record the path
    // so it still contributes to the key, with an empty root.
    if (length === 0) {
      out.push({ path, root: '' });
      return true;
    }
    return false; // a content file with no usable root: cannot address it
  }

  for (const [key, val] of Object.entries(node)) {
    if (!val || typeof val !== 'object') return false;
    if (!collectRoots(val as Record<string, unknown>, [...prefix, key], out)) {
      return false;
    }
  }
  return true;
}

/**
 * Where the `info` dictionary's bytes start and end inside a `.torrent`.
 *
 * An infohash — v1 or v2 — is the hash of the ORIGINAL bytes of the info dict,
 * not of a re-encoding of the decoded value. The two agree for a canonical
 * torrent (sorted keys, valid UTF-8 paths) and diverge for everything else, and
 * "everything else" exists in the wild: a client that emits keys out of order,
 * or a path that is not valid UTF-8, which a decoder surfaces as something it
 * cannot round-trip.
 *
 * The divergence used to be affordable because nothing matched on the v2 hash
 * — the note further down said so. The announce path matches on it now, and a
 * hash that is *usually* right is exactly the failure mode nobody would find:
 * a member with an unusual client whose hybrid torrent announces into a swarm
 * that does not exist, on a site where every other hybrid torrent works.
 *
 * So the bytes are located instead. This is a bencode scanner that walks
 * structure without interpreting it — it does not need to understand a single
 * value, only where each one ends — and returns the half-open range of the
 * top-level `info` value.
 *
 * Returns null for anything it cannot walk: a truncated file, a non-dict root,
 * no `info` key. Bounded by the buffer length on every path, so a hostile file
 * cannot make it loop.
 */
export function infoDictRange(
  bytes: Buffer
): { start: number; end: number } | null {
  // `skip` returns the index one past the value that starts at `i`, or -1.
  const skip = (i: number): number => {
    if (i >= bytes.length) return -1;
    const c = bytes[i]!;

    // Integer: `i<digits>e`.
    if (c === 0x69 /* i */) {
      const e = bytes.indexOf(0x65 /* e */, i + 1);
      return e === -1 ? -1 : e + 1;
    }

    // Dict or list: recurse until the matching `e`.
    if (c === 0x64 /* d */ || c === 0x6c /* l */) {
      let j = i + 1;
      while (j < bytes.length && bytes[j] !== 0x65 /* e */) {
        const next = skip(j);
        if (next <= j) return -1; // no progress: malformed
        j = next;
      }
      return j < bytes.length ? j + 1 : -1;
    }

    // Byte string: `<length>:<bytes>`. Digits only — a leading `-` or a
    // missing colon is malformed, not a negative length.
    if (c >= 0x30 && c <= 0x39) {
      const colon = bytes.indexOf(0x3a /* : */, i);
      if (colon === -1) return -1;
      const digits = bytes.toString('latin1', i, colon);
      if (!/^[0-9]+$/.test(digits)) return -1;
      const len = Number.parseInt(digits, 10);
      // `Number.parseInt` on a 20-digit length yields something past any real
      // buffer; the bound below rejects it either way.
      const end = colon + 1 + len;
      return end <= bytes.length ? end : -1;
    }

    return -1;
  };

  if (bytes.length < 2 || bytes[0] !== 0x64 /* d */) return null;

  let i = 1;
  while (i < bytes.length && bytes[i] !== 0x65 /* e */) {
    // Every key in a bencoded dict is a byte string.
    const keyStart = i;
    const keyEnd = skip(keyStart);
    if (keyEnd <= keyStart) return null;
    const colon = bytes.indexOf(0x3a /* : */, keyStart);
    if (colon === -1 || colon >= keyEnd) return null;
    const key = bytes.toString('latin1', colon + 1, keyEnd);

    const valEnd = skip(keyEnd);
    if (valEnd <= keyEnd) return null;

    if (key === 'info') return { start: keyEnd, end: valEnd };
    i = valEnd;
  }
  return null;
}

/** The 20-byte truncation BEP 52 announces, as hex. */
export function truncateV2(infoHashV2Hex: string): string {
  return infoHashV2Hex.slice(0, 40);
}

/**
 * Derive v2 content addressing from raw `.torrent` bytes. Compute it from the
 * exact bytes you store and serve (post-normalisation), so a client re-deriving
 * from the same file lands on the same `infoHashV2`.
 *
 * Returns `null` for a v1-only torrent, a malformed one, or one whose file tree
 * cannot be fully content-addressed.
 */
export function extractV2(torrentBytes: Buffer | Uint8Array): V2Content | null {
  let decoded: Record<string, unknown>;
  try {
    decoded = bencode.decode(
      Buffer.isBuffer(torrentBytes) ? torrentBytes : Buffer.from(torrentBytes),
    ) as Record<string, unknown>;
  } catch {
    return null;
  }
  const info = decoded?.info as Record<string, unknown> | undefined;
  if (!info || typeof info !== 'object') return null;
  if (info['meta version'] !== 2) return null;
  const tree = info['file tree'];
  if (!tree || typeof tree !== 'object') return null;

  const roots: Array<{ path: string; root: string }> = [];
  if (!collectRoots(tree as Record<string, unknown>, [], roots)) return null;
  if (!roots.length) return null;

  roots.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Hashed over the ORIGINAL info-dict bytes, located by `infoDictRange`.
  //
  // This used to hash a re-encode of the decoded dict, which is the same thing
  // for a canonical torrent and a different thing for one whose keys are out of
  // order or whose paths are not valid UTF-8. That was affordable while nothing
  // matched on the value; the announce path matches on it now, so it has to be
  // the hash a client computes rather than a hash that usually is.
  //
  // A file we cannot locate the range in is treated as unaddressable — the same
  // answer as a malformed file, and the same answer as before for anything that
  // was never going to work.
  const raw = Buffer.isBuffer(torrentBytes)
    ? torrentBytes
    : Buffer.from(torrentBytes);
  const range = infoDictRange(raw);
  if (!range) return null;

  let infoHashV2: string;
  try {
    infoHashV2 = createHash('sha256')
      .update(raw.subarray(range.start, range.end))
      .digest('hex');
  } catch {
    return null;
  }
  const contentRootV2 = createHash('sha256')
    .update(JSON.stringify(roots))
    .digest('hex');

  return {
    infoHashV2,
    infoHashV2Short: truncateV2(infoHashV2),
    contentRootV2,
    fileRoots: roots,
  };
}
