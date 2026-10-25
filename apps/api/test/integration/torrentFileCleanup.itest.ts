import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import bencode from 'bencode';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { cleanupTorrentFilesTick, CLEANUP_CURSOR_KEY } from '../../utils/torrentFileCleanup';
import { setSetting } from '../../utils/settings';
import { invalidatePanicCache } from '../../utils/panicLock';
import { infoDictRange } from '../../utils/bittorrentV2';

// The sweep that cleans the `.torrent` files stored before the upload dropped
// the uploader's fields and stopped re-keying piece layers. What has to hold:
// the passkey leaves the row, the piece layers get their raw roots back, and the
// info dict — the infohash — does not move by a single byte.

const raw = (s: string) => Buffer.from(s, 'latin1');
const bstr = (b: Buffer | string) => {
  const buf = typeof b === 'string' ? Buffer.from(b) : b;
  return Buffer.concat([raw(`${buf.length}:`), buf]);
};
const dictOf = (pairs: Array<[Buffer | string, Buffer]>) =>
  Buffer.concat([raw('d'), ...pairs.flatMap(([k, v]) => [bstr(k), v]), raw('e')]);
const enc = (v: unknown) => Buffer.from(bencode.encode(v as never));
const infoOf = (file: Buffer) => {
  const r = infoDictRange(file)!;
  return file.subarray(r.start, r.end);
};

const ROOT = Buffer.alloc(32, 0xc3);
const LAYER = Buffer.alloc(64, 0x11);
const PASSKEY = 'a'.repeat(40);

async function storeTorrent(torrentData: Buffer): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.torrents).values({
    id,
    infoHash: `${randomUUID().replace(/-/g, '')}00000000`,
    name: 'Release',
    size: 1000,
    torrentData,
    moderationStatus: 'accepted',
  });
  return id;
}

async function storedBytes(id: string): Promise<Buffer> {
  const [row] = await db
    .select({ torrentData: schema.torrents.torrentData })
    .from(schema.torrents)
    .where(eq(schema.torrents.id, id));
  return Buffer.from(row!.torrentData!);
}

describe('cleanupTorrentFilesTick', () => {
  // The setup TRUNCATEs `settings`, but `getSetting` keeps an in-process cache
  // for a minute: without this the second test resumes from the first's cursor.
  beforeEach(async () => {
    await setSetting(CLEANUP_CURSOR_KEY, '');
  });

  it('drops the uploader passkey and repairs piece layers without moving info', async () => {
    const v1Info = enc({ length: 5, name: Buffer.from('a'), 'piece length': 16384, pieces: Buffer.alloc(20), private: 1 });
    const legacy = dictOf([
      ['announce', bstr(`https://tracker.example/announce?passkey=${PASSKEY}`)],
      ['announce-list', enc([[Buffer.from(`https://tracker.example/announce?passkey=${PASSKEY}`)]])],
      ['info', v1Info],
    ]);

    const hybridInfo = enc({
      'file tree': { 'movie.mkv': { '': { length: 40000, 'pieces root': ROOT } } },
      length: 40000,
      'meta version': 2,
      name: Buffer.from('movie.mkv'),
      'piece length': 16384,
      pieces: Buffer.alloc(60, 0x22),
      private: 1,
    });
    // What the old upload stored: piece layers keyed by the hex of the root.
    const reKeyed = dictOf([
      ['info', hybridInfo],
      ['piece layers', dictOf([[Buffer.from(ROOT.toString('hex')), bstr(LAYER)]])],
    ]);

    const clean = dictOf([['info', v1Info]]);

    const legacyId = await storeTorrent(legacy);
    const reKeyedId = await storeTorrent(reKeyed);
    const cleanId = await storeTorrent(clean);

    const first = await cleanupTorrentFilesTick();
    expect(first).toEqual({ processed: 3, cleaned: 2 });

    const legacyAfter = await storedBytes(legacyId);
    expect(legacyAfter.toString('latin1')).not.toContain(PASSKEY);
    expect(infoOf(legacyAfter).equals(v1Info)).toBe(true);

    const reKeyedAfter = await storedBytes(reKeyedId);
    expect(reKeyedAfter.includes(Buffer.concat([raw('32:'), ROOT, bstr(LAYER)]))).toBe(true);
    expect(infoOf(reKeyedAfter).equals(hybridInfo)).toBe(true);

    expect((await storedBytes(cleanId)).equals(clean)).toBe(true);

    // The cursor walked past all three: a second tick has nothing to do.
    expect(await cleanupTorrentFilesTick()).toEqual({ processed: 0, cleaned: 0 });
  });

  it('moves past a file it cannot walk without writing it', async () => {
    const junkId = await storeTorrent(raw('not bencode at all'));
    expect(await cleanupTorrentFilesTick()).toEqual({ processed: 1, cleaned: 0 });
    expect((await storedBytes(junkId)).toString('latin1')).toBe('not bencode at all');
  });

  it('stands still during a panic, so the encrypted rows are not walked past', async () => {
    const legacy = dictOf([
      ['announce', bstr(`https://tracker.example/announce?passkey=${PASSKEY}`)],
      ['info', enc({ name: Buffer.from('a'), private: 1 })],
    ]);
    const id = await storeTorrent(legacy);
    const setPhase = async (phase: 'idle' | 'encrypting') => {
      await db
        .insert(schema.panicState)
        .values({ id: 'singleton', isEncrypted: false, phase })
        .onConflictDoUpdate({ target: schema.panicState.id, set: { isEncrypted: false, phase } });
      await invalidatePanicCache();
    };
    try {
      await setPhase('encrypting');
      expect(await cleanupTorrentFilesTick()).toEqual({ processed: 0, cleaned: 0 });
      expect((await storedBytes(id)).equals(legacy)).toBe(true);
    } finally {
      await setPhase('idle');
    }
    // Once the panic is over, the row is still ahead of the cursor.
    expect(await cleanupTorrentFilesTick()).toEqual({ processed: 1, cleaned: 1 });
  });
});
