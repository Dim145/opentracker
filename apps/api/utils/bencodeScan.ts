/**
 * A bencode scanner that walks structure without interpreting it: it does not
 * need to understand a single value, only where each one ends.
 *
 * Two kinds of caller need exactly that. An infohash — v1 or v2 — is the hash of
 * the ORIGINAL bytes of the info dict, so `infoDictRange` locates them rather
 * than re-encoding a decoded value. And every rewrite of a `.torrent`
 * (`torrentBytes`) splices byte ranges instead of decoding and re-encoding,
 * because `bencode@4` re-spells in hex any dictionary key that is not valid
 * UTF-8, and the keys of a BEP 52 `piece layers` dict never are.
 *
 * Everything is bounded by the buffer length on every path, so a hostile file
 * cannot make it loop.
 */

/**
 * Nothing legitimate nests past a handful of levels. The walk cannot loop —
 * every step is forward — but it recurses once per level, and a file nesting
 * fifteen thousand containers used to blow the stack on the upload path, where
 * the `RangeError` reached the member as a 500 instead of "this file cannot be
 * read".
 */
export const MAX_DEPTH = 64;

const D = 0x64; // d
const L = 0x6c; // l
const I = 0x69; // i
const E = 0x65; // e
const COLON = 0x3a;

/**
 * Index one past the bencoded value that starts at `i`, or -1 when it is
 * malformed, truncated or nested too deep.
 */
export function skipValue(bytes: Buffer, i: number, depth = 0): number {
  if (i >= bytes.length || depth > MAX_DEPTH) return -1;
  const c = bytes[i]!;

  // Integer: `i<digits>e`, optionally negative. Leading zeros and `-0` are
  // tolerated — BEP 3 forbids them, but a file stored years ago may carry one,
  // and refusing it here would make that torrent undownloadable — while
  // anything that is not a digit is malformed.
  if (c === I) {
    const e = bytes.indexOf(E, i + 1);
    if (e === -1) return -1;
    return /^-?[0-9]+$/.test(bytes.toString('latin1', i + 1, e)) ? e + 1 : -1;
  }

  // Dict or list: walk until the matching `e`.
  if (c === D || c === L) {
    let j = i + 1;
    while (j < bytes.length && bytes[j] !== E) {
      const next = skipValue(bytes, j, depth + 1);
      if (next <= j) return -1; // no progress, or too deep: malformed
      j = next;
    }
    return j < bytes.length ? j + 1 : -1;
  }

  // Byte string: `<length>:<bytes>`. Digits only — a leading `-` or a missing
  // colon is malformed, not a negative length.
  if (c >= 0x30 && c <= 0x39) {
    const colon = bytes.indexOf(COLON, i);
    if (colon === -1) return -1;
    const digits = bytes.toString('latin1', i, colon);
    if (!/^[0-9]+$/.test(digits)) return -1;
    // A 20-digit length parses to something past any real buffer; the bound
    // below rejects it either way.
    const end = colon + 1 + Number.parseInt(digits, 10);
    return end <= bytes.length ? end : -1;
  }

  return -1;
}

export interface DictEntry {
  /** The key's raw bytes — never decoded, so never re-spelled. */
  key: Buffer;
  /** Where the entry starts: the key's length prefix. */
  start: number;
  /** Where its value starts, one past the key. */
  valueStart: number;
  /** One past its value. */
  end: number;
}

/**
 * The entries of the dict that starts at `start`, in file order, and the index
 * one past its closing `e`. Null for anything that is not a well-formed dict.
 */
export function dictEntries(
  bytes: Buffer,
  start = 0,
): { entries: DictEntry[]; end: number } | null {
  if (start >= bytes.length || bytes[start] !== D) return null;
  const entries: DictEntry[] = [];
  let i = start + 1;
  while (i < bytes.length && bytes[i] !== E) {
    // Every key in a bencoded dict is a byte string.
    if (bytes[i]! < 0x30 || bytes[i]! > 0x39) return null;
    const keyEnd = skipValue(bytes, i);
    if (keyEnd <= i) return null;
    const colon = bytes.indexOf(COLON, i);
    if (colon === -1 || colon >= keyEnd) return null;
    const end = skipValue(bytes, keyEnd);
    if (end <= keyEnd) return null;
    entries.push({ key: bytes.subarray(colon + 1, keyEnd), start: i, valueStart: keyEnd, end });
    i = end;
  }
  return i < bytes.length ? { entries, end: i + 1 } : null;
}
