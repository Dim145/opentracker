import { describe, it, expect, afterEach } from 'vitest';
import bencode from 'bencode';
import { dictEntries, skipValue } from '../utils/bencodeScan';
import {
  cleanStoredTorrent,
  normalizeUploadedTorrent,
  personalizeTorrent,
} from '../utils/torrentBytes';
import { infoDictRange } from '../utils/bittorrentV2';
import { personalAnnounceUrls, trackerUdpEnabled } from '../utils/announceUrls';

// The files are built by hand, byte by byte where it matters: the faults these
// tests pin down live in keys a JS object cannot hold (raw 32-byte roots), so
// `bencode.encode` can only build the parts whose keys are plain text.

const raw = (s: string) => Buffer.from(s, 'latin1');
const bstr = (b: Buffer | string) => {
  const buf = typeof b === 'string' ? Buffer.from(b) : b;
  return Buffer.concat([raw(`${buf.length}:`), buf]);
};
/** A bencoded dict with the entries in the order given, keys as raw bytes. */
function dictOf(pairs: Array<[Buffer | string, Buffer]>): Buffer {
  return Buffer.concat([raw('d'), ...pairs.flatMap(([k, v]) => [bstr(k), v]), raw('e')]);
}
const enc = (v: unknown) => Buffer.from(bencode.encode(v as never));

/** The info dict's bytes, located the way the infohash is computed. */
function infoBytes(file: Buffer): Buffer {
  const r = infoDictRange(file)!;
  return file.subarray(r.start, r.end);
}

const ROOT = Buffer.alloc(32, 0xc3); // 0xc3 alone is invalid UTF-8: a realistic root
const LAYER = Buffer.alloc(64, 0x11); // two 32-byte hashes

/** A hybrid info dict (v1 `pieces` + v2 `file tree`) whose single file has ROOT. */
function hybridInfo(extra: Record<string, unknown> = {}): Buffer {
  return enc({
    'file tree': { 'movie.mkv': { '': { length: 40000, 'pieces root': ROOT } } },
    length: 40000,
    'meta version': 2,
    name: Buffer.from('movie.mkv'),
    'piece length': 16384,
    pieces: Buffer.alloc(60, 0x22),
    ...extra,
  });
}

/** A whole hybrid `.torrent`, piece layers keyed by `layerKey`. */
function hybridFile(layerKey: Buffer, info = hybridInfo()): Buffer {
  return dictOf([
    ['announce', bstr('http://other.tracker/announce?passkey=deadbeef')],
    ['info', info],
    ['piece layers', dictOf([[layerKey, bstr(LAYER)]])],
  ]);
}

describe('bencodeScan', () => {
  it('lists dict entries with their raw keys and ranges', () => {
    const file = dictOf([['a', raw('i1e')], [ROOT, bstr('x')]]);
    const d = dictEntries(file)!;
    expect(d.end).toBe(file.length);
    expect(d.entries.map((e) => e.key)).toEqual([Buffer.from('a'), ROOT]);
    expect(file.subarray(d.entries[0]!.valueStart, d.entries[0]!.end).toString()).toBe('i1e');
  });

  it('rejects what is not a well-formed dict', () => {
    expect(dictEntries(Buffer.alloc(0))).toBeNull();
    expect(dictEntries(raw('l1:ae'))).toBeNull(); // list root
    expect(dictEntries(raw('di1ei2ee'))).toBeNull(); // integer key
    expect(dictEntries(raw('d1:a'))).toBeNull(); // value missing
    expect(dictEntries(raw('d1:ai1e'))).toBeNull(); // unterminated
    expect(skipValue(raw('5:ab'), 0)).toBe(-1); // length past EOF
    expect(skipValue(raw('-1:a'), 0)).toBe(-1);
  });

  it('terminates on deeply nested junk', () => {
    const started = Date.now();
    expect(dictEntries(raw('d1:a' + 'l'.repeat(5000)))).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('the bencode round trip these helpers replace', () => {
  it('re-keys piece layers in hex — the fault being fixed', () => {
    // Pins the library behaviour the module comment describes, so a future
    // bencode that keeps raw keys shows up here rather than silently.
    // Key AND value: `32:<root>` alone also occurs inside `info`, as the file's
    // `pieces root` — a value, which the decoder keeps raw.
    const file = hybridFile(ROOT);
    const roundTrip = enc(bencode.decode(file));
    expect(file.includes(Buffer.concat([raw('32:'), ROOT, bstr(LAYER)]))).toBe(true);
    expect(roundTrip.includes(Buffer.concat([raw('32:'), ROOT, bstr(LAYER)]))).toBe(false);
    expect(roundTrip.includes(Buffer.concat([raw(`64:${ROOT.toString('hex')}`), bstr(LAYER)]))).toBe(true);
  });
});

describe('normalizeUploadedTorrent', () => {
  it('drops the uploader fields, keeps the rest, forces private', () => {
    const info = enc({ length: 5, name: Buffer.from('a'), 'piece length': 16384, pieces: Buffer.alloc(20) });
    const file = dictOf([
      ['announce', bstr('http://t/announce?passkey=secret')],
      ['announce-list', enc([[Buffer.from('http://t/announce?passkey=secret')]])],
      ['comment', bstr('hi')],
      ['created by', bstr('mktorrent')],
      ['creation date', raw('i1700000000e')],
      ['info', info],
      ['url-list', enc([Buffer.from('http://webseed')])],
    ]);
    const out = normalizeUploadedTorrent(file);
    expect(out.toString('latin1')).not.toContain('secret');
    expect(Object.keys(bencode.decode(out) as object)).toEqual(['creation date', 'info']);
    // `private` lands where a sorted dict holds it: after `pieces`.
    expect(infoBytes(out).equals(enc({ length: 5, name: Buffer.from('a'), 'piece length': 16384, pieces: Buffer.alloc(20), private: 1 }))).toBe(true);
  });

  it('leaves a private info dict byte for byte, and fixes private=0', () => {
    const p1 = enc({ name: Buffer.from('a'), private: 1 });
    expect(infoBytes(normalizeUploadedTorrent(dictOf([['info', p1]]))).equals(p1)).toBe(true);
    const p0 = enc({ name: Buffer.from('a'), private: 0 });
    expect(infoBytes(normalizeUploadedTorrent(dictOf([['info', p0]]))).equals(p1)).toBe(true);
  });

  it('keeps the piece layers of a v2 torrent intact', () => {
    const file = hybridFile(ROOT, hybridInfo({ private: 1 }));
    const out = normalizeUploadedTorrent(file);
    expect(out.includes(Buffer.concat([raw('32:'), ROOT, bstr(LAYER)]))).toBe(true);
    expect(infoBytes(out).equals(infoBytes(file))).toBe(true);
  });

  it('keeps a file tree path that is not valid UTF-8', () => {
    // Inside `info`: a re-encode would re-spell it, and move both infohashes.
    const badPath = Buffer.from([0x66, 0xff, 0x6f]);
    const tree = dictOf([[badPath, dictOf([['', enc({ length: 1, 'pieces root': ROOT })]])]]);
    const info = dictOf([['file tree', tree], ['meta version', raw('i2e')], ['name', bstr('x')], ['private', raw('i1e')]]);
    const out = normalizeUploadedTorrent(dictOf([['info', info]]));
    expect(infoBytes(out).equals(info)).toBe(true);
  });

  it('throws on anything it cannot walk', () => {
    expect(() => normalizeUploadedTorrent(raw('not bencode'))).toThrow();
    expect(() => normalizeUploadedTorrent(dictOf([['name', bstr('no info')]]))).toThrow();
    expect(() => normalizeUploadedTorrent(dictOf([['info', bstr('not a dict')]]))).toThrow();
    expect(() => normalizeUploadedTorrent(raw('d4:infod4:name1:a'))).toThrow();
  });
});

describe('personalizeTorrent', () => {
  it('writes the member announce and tiers without touching info or piece layers', () => {
    const file = hybridFile(ROOT, hybridInfo({ private: 1 }));
    const out = personalizeTorrent(file, 'http://us/announce?passkey=mine', [
      ['http://us/announce?passkey=mine'],
      ['udp://us:6969/announce/mine'],
    ]);
    const d = bencode.decode(out) as Record<string, unknown>;
    expect(Buffer.from(d.announce as Uint8Array).toString()).toBe('http://us/announce?passkey=mine');
    expect((d['announce-list'] as Uint8Array[][]).map((t) => t.map((u) => Buffer.from(u).toString()))).toEqual([
      ['http://us/announce?passkey=mine'],
      ['udp://us:6969/announce/mine'],
    ]);
    expect(out.toString('latin1')).not.toContain('deadbeef');
    expect(infoBytes(out).equals(infoBytes(file))).toBe(true);
    expect(out.includes(Buffer.concat([raw('32:'), ROOT, bstr(LAYER)]))).toBe(true);
  });

  it('strips the uploader fields of a row stored before the upload did', () => {
    const file = dictOf([
      ['comment', bstr('x')],
      ['info', enc({ name: Buffer.from('a'), private: 1 })],
      ['url-list', enc([Buffer.from('http://webseed')])],
    ]);
    const out = personalizeTorrent(file, 'http://us/a', [['http://us/a']]);
    expect(Object.keys(bencode.decode(out) as object)).toEqual(['announce', 'announce-list', 'info']);
  });
});

describe('cleanStoredTorrent', () => {
  it('turns hex-spelled piece layer keys back into the roots they name', () => {
    const stored = hybridFile(Buffer.from(ROOT.toString('hex')), hybridInfo({ private: 1 }));
    const out = cleanStoredTorrent(stored)!;
    expect(out).not.toBeNull();
    expect(out.includes(Buffer.concat([raw('32:'), ROOT, bstr(LAYER)]))).toBe(true);
    expect(out.toString('latin1')).not.toContain('passkey');
    expect(infoBytes(out).equals(infoBytes(stored))).toBe(true);
  });

  it('leaves a 64-character key that is no root of this torrent', () => {
    const stranger = Buffer.from(Buffer.alloc(32, 0x7e).toString('hex'));
    const stored = dictOf([
      ['info', hybridInfo({ private: 1 })],
      ['piece layers', dictOf([[stranger, bstr(LAYER)]])],
    ]);
    expect(cleanStoredTorrent(stored)).toBeNull();
  });

  it('returns null for a row that needs nothing, or cannot be walked', () => {
    expect(cleanStoredTorrent(dictOf([['info', enc({ name: Buffer.from('a'), private: 1 })]]))).toBeNull();
    expect(cleanStoredTorrent(raw('garbage'))).toBeNull();
  });

  it('never touches info, not even a missing private flag', () => {
    const info = enc({ name: Buffer.from('a') });
    const out = cleanStoredTorrent(dictOf([['announce', bstr('http://x')], ['info', info]]))!;
    expect(infoBytes(out).equals(info)).toBe(true);
  });
});

describe('personalAnnounceUrls', () => {
  const cfg = { httpUrl: 'https://t.example/announce', udpUrl: 'udp://t.example:6969/announce/', udpEnabled: true };

  it('puts HTTP and UDP in their own tiers', () => {
    const r = personalAnnounceUrls('pk', cfg);
    expect(r.announce).toBe('https://t.example/announce?passkey=pk');
    expect(r.tiers).toEqual([['https://t.example/announce?passkey=pk'], ['udp://t.example:6969/announce/pk']]);
  });

  it('leaves UDP out when the tracker does not serve it, or no URL is set', () => {
    expect(personalAnnounceUrls('pk', { ...cfg, udpEnabled: false }).tiers).toHaveLength(1);
    expect(personalAnnounceUrls('pk', { ...cfg, udpUrl: '' }).tiers).toHaveLength(1);
  });
});

describe('trackerUdpEnabled', () => {
  const saved = process.env.TRACKER_UDP_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.TRACKER_UDP_ENABLED;
    else process.env.TRACKER_UDP_ENABLED = saved;
  });

  it('reads the variable exactly as the tracker does', () => {
    delete process.env.TRACKER_UDP_ENABLED;
    expect(trackerUdpEnabled()).toBe(true);
    process.env.TRACKER_UDP_ENABLED = '';
    expect(trackerUdpEnabled()).toBe(true);
    process.env.TRACKER_UDP_ENABLED = 'true';
    expect(trackerUdpEnabled()).toBe(true);
    process.env.TRACKER_UDP_ENABLED = 'false';
    expect(trackerUdpEnabled()).toBe(false);
    process.env.TRACKER_UDP_ENABLED = '1';
    expect(trackerUdpEnabled()).toBe(false);
  });
});
