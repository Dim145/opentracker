import { describe, it, expect } from 'vitest';
import bencode from 'bencode';
import { createHash } from 'node:crypto';
import { extractV2 } from '../utils/bittorrentV2';

// The whole value of this module is crypto correctness, so the tests build
// bencoded torrents by hand and assert the exact bytes-derived values — above
// all the two cross-tracker invariants: `contentRootV2` ignores piece length and
// the private flag, while `infoHashV2` moves with them.

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

function leaf(length: number, rootByte: number) {
  return { '': { length, 'pieces root': Buffer.alloc(32, rootByte) } };
}

function v2Info(
  fileTree: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    'meta version': 2,
    name: Buffer.from('Release'),
    'piece length': 16384,
    'file tree': fileTree,
    ...extra,
  };
}

function torrentOf(info: Record<string, unknown>): Buffer {
  return Buffer.from(
    bencode.encode({ announce: Buffer.from('http://tracker'), info }),
  );
}

describe('extractV2', () => {
  it('derives infoHashV2, contentRootV2 and per-file roots for a v2 torrent', () => {
    const info = v2Info({ 'movie.mkv': leaf(1000, 7) });
    const r = extractV2(torrentOf(info));
    expect(r).not.toBeNull();
    expect(r!.infoHashV2).toBe(sha256(bencode.encode(info)));
    expect(r!.fileRoots).toEqual([
      { path: 'movie.mkv', root: Buffer.alloc(32, 7).toString('hex') },
    ]);
    expect(r!.contentRootV2).toBe(sha256(Buffer.from(JSON.stringify(r!.fileRoots))));
  });

  it('contentRootV2 is independent of piece length; infoHashV2 is not', () => {
    const a = extractV2(torrentOf(v2Info({ 'f.mkv': leaf(1000, 7) }, { 'piece length': 16384 })));
    const b = extractV2(torrentOf(v2Info({ 'f.mkv': leaf(1000, 7) }, { 'piece length': 65536 })));
    expect(a!.contentRootV2).toBe(b!.contentRootV2);
    expect(a!.infoHashV2).not.toBe(b!.infoHashV2);
  });

  it('contentRootV2 is independent of the private flag; infoHashV2 is not', () => {
    const a = extractV2(torrentOf(v2Info({ 'f.mkv': leaf(1000, 7) })));
    const b = extractV2(torrentOf(v2Info({ 'f.mkv': leaf(1000, 7) }, { private: 1 })));
    expect(a!.contentRootV2).toBe(b!.contentRootV2);
    expect(a!.infoHashV2).not.toBe(b!.infoHashV2);
  });

  it('two identical releases match; a different byte does not', () => {
    const same1 = extractV2(torrentOf(v2Info({ 'f.mkv': leaf(1000, 7) })));
    const same2 = extractV2(torrentOf(v2Info({ 'f.mkv': leaf(1000, 7) })));
    const other = extractV2(torrentOf(v2Info({ 'f.mkv': leaf(1000, 8) })));
    expect(same1!.contentRootV2).toBe(same2!.contentRootV2);
    expect(same1!.contentRootV2).not.toBe(other!.contentRootV2);
  });

  it('sorts files by path and walks nested directories', () => {
    const info = v2Info({ 'b.mkv': leaf(10, 1), dir: { 'a.mkv': leaf(20, 2) } });
    const r = extractV2(torrentOf(info));
    expect(r!.fileRoots.map((f) => f.path)).toEqual(['b.mkv', 'dir/a.mkv']);
  });

  it('excludes padding files from the content key', () => {
    const padded = v2Info({
      'f.mkv': leaf(1000, 7),
      '.pad': { '': { length: 500, 'pieces root': Buffer.alloc(32, 9), attr: Buffer.from('p') } },
    });
    const plain = extractV2(torrentOf(v2Info({ 'f.mkv': leaf(1000, 7) })));
    const r = extractV2(torrentOf(padded));
    expect(r!.fileRoots.map((f) => f.path)).toEqual(['f.mkv']);
    // Padding must not perturb the cross-tracker key.
    expect(r!.contentRootV2).toBe(plain!.contentRootV2);
  });

  it('returns null for a v1-only torrent', () => {
    const v1 = { name: Buffer.from('R'), 'piece length': 16384, length: 1000, pieces: Buffer.alloc(20) };
    expect(extractV2(Buffer.from(bencode.encode({ info: v1 })))).toBeNull();
  });

  it('returns null when a content file has no usable root', () => {
    const info = v2Info({ 'f.mkv': { '': { length: 1000 } } });
    expect(extractV2(torrentOf(info))).toBeNull();
  });

  it('rejects a malformed node that is both a file and a directory', () => {
    const info = v2Info({
      weird: {
        '': { length: 10, 'pieces root': Buffer.alloc(32, 1) },
        'child.mkv': leaf(20, 2),
      },
    });
    expect(extractV2(torrentOf(info))).toBeNull();
  });

  it('returns null on garbage input', () => {
    expect(extractV2(Buffer.from('not bencode'))).toBeNull();
  });
});
