# BitTorrent v2 (BEP 52)

A v2 or hybrid torrent announces under a **second infohash**. The tracker
recognises it, and folds both halves of a hybrid torrent's swarm into one.

## The two hashes

BitTorrent v1 identifies a torrent by the SHA-1 of its `info` dictionary. v2
moved to SHA-256 — but the tracker and DHT protocols were built around 20-byte
hashes and have no room for 32, so a v2 client announces the **SHA-256
truncated to 20 bytes**.

A **hybrid** torrent carries the fields of both formats and therefore has both
hashes. A client that speaks v2 joins both swarms, which means it sends two
announces, under two different hashes, for the same content.

## What used to happen

The announce path looked a torrent up by `info_hash` and nothing else. So the
second announce found no row:

- the member saw a torrent that worked and, beside it, an announce erroring
  every interval;
- the swarm was split in two, because v1-only peers and v2-capable peers were
  keyed apart in Redis and could not be handed each other's addresses.

## What happens now

The announce path resolves the hash it was given in two steps:

1. **v1 first** — a unique-index lookup on `info_hash`, the overwhelmingly
   common case, unchanged and paying nothing for any of this.
2. **v2 on a miss** — a partial expression index over `left(info_hash_v2, 40)`,
   which is exactly the truncation a client sends.

Either way the resolver hands back the torrent's **canonical v1 hash**, and the
announce uses it as the swarm key from there on — peer set, dedup window,
completed counter, seed-time bookkeeping, anti-cheat. That single substitution
is what merges the swarm.

A v2 announce therefore costs two lookups where a v1 announce costs one, which
is the right way round: the rare case pays.

`/scrape` does the same, for both HTTP and UDP, but only for hashes Redis has
never heard of and at most 8 per request. A scrape carries up to 64 hashes and
used to cost zero queries; resolving all of them would be a denial of service
handed out for free. Past that budget the answer is what it was before —
zeroes — never something worse.

## Peers announcing under both hashes

The spec does not say how a client should announce when it joins both swarms of
a hybrid torrent, so this is a choice, and it is stated rather than assumed:
**nothing deduplicates a peer that announces both swarms under two different
`peer_id`s.**

libtorrent reuses one `peer_id`, so the Redis key `(swarm, peer)` collapses the
pair by itself and the common case is exact. A client that rotated its id would
be counted twice — the same as a member running two clients today, and bounded
by the same per-announce cap and the same anti-cheat heuristics. Deduplicating
by `(user, torrent)` instead would mean rebuilding the peer store around a
different key, which is a much larger change than the problem warrants.

## Content addressing

Two more values are derived at upload time and stored on the torrent:

- **`info_hash_v2`** — the SHA-256 of the `info` dictionary, hashed over the
  file's **original bytes**. Not over a re-encoding of the decoded value: the
  two agree for a canonical torrent and diverge for one whose keys are unsorted
  or whose paths are not valid UTF-8, and the announce path has to match the
  hash a client actually computes.
- **`content_root_v2`** — a cross-tracker content key over the sorted per-file
  Merkle roots. Because a v2 file root is a property of the file's content
  alone — independent of piece length, of the `private` flag, and of every
  other file in the torrent — two uploads of the same release on two different
  trackers derive the **same** value.

That second one is the cryptographic upgrade of `content_signature`, which the
[Cross-seed](./cross-seed.md) surface uses today: same shape, but the root
proves the bytes where paths-and-sizes only guessed them.

## Upgrading

Nothing to do. Uploads are addressed as they arrive, and a boot-mounted sweep
walks the existing catalogue once, re-deriving both values from the `.torrent`
bytes already stored. It is capped, cross-replica locked and resumable, so it
cannot lock the table or run twice.

A v1-only torrent yields neither value and is unaffected.
