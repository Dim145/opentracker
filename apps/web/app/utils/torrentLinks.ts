/**
 * Pull torrent references out of a message body.
 *
 * Matches both a bare path and a full URL, on any host: somebody pasting
 * from another tab brings the origin with them, and refusing to recognise
 * that would make the feature work for half the ways people actually
 * paste.
 *
 * A 40-hex infohash only. Anything looser starts matching commit SHAs and
 * random identifiers, and every false positive costs the reader a
 * request that 404s.
 */
const TORRENT_REF = /(?:^|\s|\()(?:https?:\/\/[^\s/]+)?\/torrents\/([0-9a-f]{40})\b/gi;

/** Distinct hashes, in the order they appear, capped. */
export function torrentHashesIn(body: string | null | undefined, max = 3): string[] {
  if (!body) return [];
  const out: string[] = [];
  // A message full of links must not turn into a message full of
  // requests; three is enough to be useful and bounded enough to be safe.
  for (const m of body.matchAll(TORRENT_REF)) {
    const hash = m[1]!.toLowerCase();
    if (!out.includes(hash)) out.push(hash);
    if (out.length >= max) break;
  }
  return out;
}
