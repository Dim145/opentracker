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

  // NOTE: this hashes a RE-ENCODE of the decoded info dict, not the original
  // byte slice. For a canonical torrent (sorted keys, UTF-8 paths) that equals
  // the true BEP-52 infohash; for a non-canonical dict, or a path that is not
  // valid UTF-8 (which `bencode` surfaces as a hex string), it diverges. We can
  // afford that because `infoHashV2` is only stored and carried in the record —
  // nothing joins or matches on it — and `contentRootV2` (the key that IS
  // matched) stays deterministic within this codebase, so opentracker↔opentracker
  // matching is unaffected. If a future consumer needs the portable, exact v2
  // infohash, compute it from the original info-dict byte range instead.
  let infoHashV2: string;
  try {
    infoHashV2 = createHash('sha256').update(bencode.encode(info)).digest('hex');
  } catch {
    return null;
  }
  const contentRootV2 = createHash('sha256')
    .update(JSON.stringify(roots))
    .digest('hex');

  return { infoHashV2, contentRootV2, fileRoots: roots };
}
