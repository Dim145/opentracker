/**
 * `parse-torrent` is overloaded three ways. Fed a Buffer it declares
 * `MagnetUri.Instance | ParseTorrentFile.Instance` — a union where every field
 * is optional, so `name`, `length`, `files` and `infoHash` are all reachable
 * only after a narrowing none of the callers performed. Its own merged
 * `Instance` type is what the callers actually want: same fields, plus
 * `infoHash` as a required string.
 *
 * This wrapper narrows once, with a runtime check rather than a bare cast. A
 * magnet URI carries no `info` dictionary, so if one ever reaches a caller
 * expecting file metadata we fail loudly here instead of reading
 * `undefined.length` somewhere downstream.
 */
import parseTorrent from 'parse-torrent';
import type { Instance } from 'parse-torrent';

export type ParsedTorrentFile = Instance;

export async function parseTorrentFile(
  data: Buffer | Uint8Array
): Promise<Instance> {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const parsed = await parseTorrent(buffer);
  if (!('info' in parsed) || !parsed.info) {
    throw new Error(
      'parse-torrent returned a magnet URI where .torrent bytes were expected'
    );
  }
  return parsed as Instance;
}
