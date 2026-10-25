/**
 * Byte-level edits to a `.torrent`, for every place that rewrites one: the
 * upload (drops the uploader's own fields, forces `private`), the two download
 * routes (write the member's announce URLs) and the backfill that cleans the
 * rows stored before the upload did either.
 *
 * ## Why not decode, mutate, encode
 *
 * `bencode@4` decodes every dictionary KEY to a string, and a key that is not
 * valid UTF-8 comes back spelled in hex (`decode.dictionary` in
 * bencode/lib/decode.js). Encoding then writes the hex — 64 ASCII bytes where
 * there were 32 raw ones. The keys of a BEP 52 `piece layers` dict are raw
 * 32-byte Merkle roots, so every v2 or hybrid `.torrent` that went through the
 * upload, and again through each download, came out with its piece layers
 * re-keyed: a v2 client looks a layer up by its file's `pieces root` and finds
 * nothing. A `file tree` path that is not valid UTF-8 suffers the same, inside
 * `info`, where it also moves the infohash.
 *
 * So nothing here decodes a value it does not edit. The scanner (`bencodeScan`)
 * only finds where each value ends, and an edit splices byte ranges: everything
 * it does not touch is copied verbatim.
 */
import { MAX_DEPTH, dictEntries, skipValue, type DictEntry } from '~~/utils/bencodeScan';
import { extractV2 } from '~~/utils/bittorrentV2';

/** A bencoded byte string. */
function str(value: Buffer | string): Buffer {
  const b = typeof value === 'string' ? Buffer.from(value) : value;
  return Buffer.concat([Buffer.from(`${b.length}:`, 'latin1'), b]);
}

/** A bencoded list of lists of strings — the shape of `announce-list`. */
function tierList(tiers: string[][]): Buffer {
  const parts: Buffer[] = [Buffer.from('l')];
  for (const tier of tiers) {
    parts.push(Buffer.from('l'), ...tier.map((url) => str(url)), Buffer.from('e'));
  }
  parts.push(Buffer.from('e'));
  return Buffer.concat(parts);
}

/**
 * Rewrites the dict at `start`. A key named in `edits` takes the new value, or
 * disappears for `null`; a named key the dict lacks is inserted where a sorted
 * dict would hold it (bencode requires sorted keys, compared as raw bytes).
 * Every other entry is copied byte for byte, key included.
 */
function rewriteDict(
  bytes: Buffer,
  start: number,
  edits: Map<string, Buffer | null>,
): Buffer | null {
  const dict = dictEntries(bytes, start);
  if (!dict) return null;

  // Edit keys are ASCII, so `latin1` compares them with the raw key bytes
  // exactly — a non-ASCII key maps to characters no edit key contains.
  const name = (e: DictEntry) => e.key.toString('latin1');
  const present = new Set(dict.entries.map(name));
  const missing = [...edits]
    .filter(([k, v]) => v !== null && !present.has(k))
    .map(([k, v]) => ({ key: Buffer.from(k, 'latin1'), value: v! }))
    .sort((a, b) => Buffer.compare(a.key, b.key));

  const parts: Buffer[] = [Buffer.from('d')];
  const insertBefore = (key: Buffer | null) => {
    while (missing.length && (key === null || Buffer.compare(missing[0]!.key, key) < 0)) {
      const m = missing.shift()!;
      parts.push(str(m.key), m.value);
    }
  };
  for (const e of dict.entries) {
    insertBefore(e.key);
    const k = name(e);
    if (!edits.has(k)) {
      parts.push(bytes.subarray(e.start, e.end));
      continue;
    }
    const value = edits.get(k)!;
    if (value !== null) parts.push(bytes.subarray(e.start, e.valueStart), value);
  }
  insertBefore(null);
  parts.push(Buffer.from('e'));
  return Buffer.concat(parts);
}

/**
 * The value at `start` with the entries of every dictionary in sorted key
 * order, at every depth; strings and integers are copied verbatim, and a value
 * that is already canonical comes back as the very same bytes.
 *
 * The upload got this for free from decode → encode, which sorted every
 * dictionary (and re-spelled every binary key). A file from a careless encoder,
 * keys out of order, was therefore stored canonical, under the canonical
 * infohash; kept as it came, the same release uploaded again hashed apart from
 * the row stored before, and the duplicate check missed it. Sorting by raw key
 * bytes is the order bencode defines, and a key that occurs twice keeps its
 * last value, as the decoder did.
 */
function canonical(
  bytes: Buffer,
  start: number,
  depth = 0,
): { out: Buffer; end: number; changed: boolean } | null {
  if (depth > MAX_DEPTH) return null;
  if (bytes[start] === 0x64) {
    const dict = dictEntries(bytes, start);
    if (!dict) return null;
    let changed = false;
    let previous: Buffer | null = null;
    // `latin1` maps bytes to characters one to one: distinct raw keys stay distinct.
    const byKey = new Map<string, { key: Buffer; value: Buffer }>();
    for (const e of dict.entries) {
      const v = canonical(bytes, e.valueStart, depth + 1);
      if (!v) return null;
      // A value rebuilt below, or a key out of order or repeated: rebuild this one.
      if (v.changed || (previous && Buffer.compare(previous, e.key) >= 0)) changed = true;
      previous = e.key;
      byKey.set(e.key.toString('latin1'), { key: e.key, value: v.out });
    }
    if (!changed) return { out: bytes.subarray(start, dict.end), end: dict.end, changed };
    const entries = [...byKey.values()].sort((a, b) => Buffer.compare(a.key, b.key));
    return {
      out: Buffer.concat([Buffer.from('d'), ...entries.flatMap((e) => [str(e.key), e.value]), Buffer.from('e')]),
      end: dict.end,
      changed,
    };
  }
  if (bytes[start] === 0x6c) {
    let changed = false;
    const parts: Buffer[] = [];
    let i = start + 1;
    while (i < bytes.length && bytes[i] !== 0x65) {
      const v = canonical(bytes, i, depth + 1);
      if (!v) return null;
      changed ||= v.changed;
      parts.push(v.out);
      i = v.end;
    }
    if (i >= bytes.length) return null;
    const out = changed
      ? Buffer.concat([Buffer.from('l'), ...parts, Buffer.from('e')])
      : bytes.subarray(start, i + 1);
    return { out, end: i + 1, changed };
  }
  const end = skipValue(bytes, start);
  return end > start ? { out: bytes.subarray(start, end), end, changed: false } : null;
}

/**
 * The top-level fields that carry the uploader's own announce URLs, or text from
 * a foreign file that has no use here.
 *
 * A private tracker's `.torrent` holds its owner's passkey in `announce` and in
 * every tier of `announce-list`, and in a cross-seed the file usually comes from
 * ANOTHER private tracker, whose passkey has no business being stored here.
 * `url-list` (web seeds) would point every downloader's client at a third-party
 * host. `comment` and `created by` are free text with no use here. None of them
 * is inside `info`, so dropping them never moves the infohash.
 */
export const UPLOADER_FIELDS = ['announce', 'announce-list', 'url-list', 'comment', 'created by'] as const;

const PRIVATE = Buffer.from('i1e');

/** The `info` value with `private` forced to 1; null when there is no info dict. */
function privateInfo(bytes: Buffer, top: { entries: DictEntry[] }): Buffer | null {
  const info = top.entries.find((e) => e.key.toString('latin1') === 'info');
  if (!info) return null;
  return rewriteDict(bytes, info.valueStart, new Map([['private', PRIVATE]]));
}

/**
 * The upload's normalisation: `info.private` forced to 1 and the uploader's
 * fields dropped. The result is what the site stores, serves and hashes.
 *
 * Throws on anything it cannot walk; the caller answers 400.
 */
export function normalizeUploadedTorrent(upload: Buffer): Buffer {
  const raw = canonical(upload, 0)?.out;
  const top = raw && dictEntries(raw);
  if (!raw || !top) throw new Error('not a bencoded dictionary');
  const info = privateInfo(raw, top);
  if (!info) throw new Error('missing info dict');
  const edits = new Map<string, Buffer | null>(UPLOADER_FIELDS.map((k) => [k, null]));
  edits.set('info', info);
  const out = rewriteDict(raw, 0, edits);
  if (!out) throw new Error('not a bencoded dictionary');
  return out;
}

/**
 * A member's copy: their announce URL and tier list, `private` forced to 1,
 * and none of the uploader's fields, so a row stored before the upload dropped
 * them still serves without them. `info` and `piece layers` leave as stored.
 *
 * Throws on a stored file it cannot walk.
 */
export function personalizeTorrent(raw: Buffer, announce: string, tiers: string[][]): Buffer {
  const top = dictEntries(raw);
  if (!top) throw new Error('not a bencoded dictionary');
  const info = privateInfo(raw, top);
  if (!info) throw new Error('missing info dict');
  const edits = new Map<string, Buffer | null>(UPLOADER_FIELDS.map((k) => [k, null]));
  edits.set('announce', str(announce));
  edits.set('announce-list', tierList(tiers));
  edits.set('info', info);
  const out = rewriteDict(raw, 0, edits);
  if (!out) throw new Error('not a bencoded dictionary');
  return out;
}

/**
 * The piece layers of a v2 or hybrid torrent with their keys put back to raw
 * 32-byte roots, after the upload re-spelled them in hex (see the module
 * comment). Null when there is nothing to repair, or anything to doubt.
 *
 * A key is only converted back when its hex spelling names the `pieces root` of
 * a file in this torrent's own `file tree`: a real 32-byte root is never 64
 * bytes long, and a 64-character key that is not one of our roots is left as
 * found. Hex preserves byte order, so the repaired dict comes out sorted; it is
 * sorted again anyway, and a repaired key that collides with a key already
 * there aborts the repair.
 */
function repairedPieceLayers(raw: Buffer, top: { entries: DictEntry[] }): Buffer | null {
  const layers = top.entries.find((e) => e.key.toString('latin1') === 'piece layers');
  if (!layers) return null;
  const dict = dictEntries(raw, layers.valueStart);
  if (!dict) return null;
  const roots = new Set(extractV2(raw)?.fileRoots.map((f) => f.root) ?? []);
  if (!roots.size) return null;

  let changed = false;
  const entries = dict.entries.map((e) => {
    const k = e.key.toString('latin1');
    if (k.length === 64 && /^[0-9a-f]+$/.test(k) && roots.has(k)) {
      changed = true;
      return { key: Buffer.from(k, 'hex'), value: raw.subarray(e.valueStart, e.end) };
    }
    return { key: e.key, value: raw.subarray(e.valueStart, e.end) };
  });
  if (!changed) return null;

  entries.sort((a, b) => Buffer.compare(a.key, b.key));
  for (let i = 1; i < entries.length; i++) {
    if (Buffer.compare(entries[i - 1]!.key, entries[i]!.key) === 0) return null;
  }
  return Buffer.concat([
    Buffer.from('d'),
    ...entries.flatMap((e) => [str(e.key), e.value]),
    Buffer.from('e'),
  ]);
}

/**
 * What the backfill applies to a stored row: the uploader's fields dropped and
 * the piece layers re-keyed. `info` is copied verbatim — not even `private` is
 * touched — so the infohash cannot move. Null when the row needs nothing, or
 * cannot be walked.
 */
export function cleanStoredTorrent(raw: Buffer): Buffer | null {
  const top = dictEntries(raw);
  if (!top) return null;
  const names = new Set(top.entries.map((e) => e.key.toString('latin1')));
  const edits = new Map<string, Buffer | null>(
    UPLOADER_FIELDS.filter((k) => names.has(k)).map((k) => [k, null]),
  );
  const layers = repairedPieceLayers(raw, top);
  if (layers) edits.set('piece layers', layers);
  if (!edits.size) return null;
  return rewriteDict(raw, 0, edits);
}
