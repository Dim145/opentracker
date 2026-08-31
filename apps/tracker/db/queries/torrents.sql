-- name: FindActiveTorrentByInfoHash :one
-- Returns the active torrent matching the given hex info_hash, or no rows
-- if either it doesn't exist or it's been deactivated.
SELECT id
  FROM torrents
 WHERE info_hash = $1
   AND is_active = true
 LIMIT 1;

-- name: FindActiveTorrentByInfoHashV2Short :one
-- The BEP 52 second swarm.
--
-- A v2 or hybrid torrent has two infohashes and a client that supports v2
-- announces the SHA-256 one — truncated to 20 bytes, because the tracker
-- protocol has no room for 32. That truncation is the first 40 hex characters
-- of `info_hash_v2`, which is what this matches.
--
-- Returns the canonical `info_hash` alongside the id, and the caller switches
-- to it as the swarm key. That is what merges the two halves of a hybrid
-- torrent's swarm instead of leaving v1-only and v2-capable peers unable to
-- see each other.
--
-- Served by `torrents_info_hash_v2_short_idx`, a partial expression index — so
-- this costs an index lookup, not a scan, and only v2 rows are in it.
--
-- The parameter is cast: `info_hash_v2` is nullable, so sqlc infers a nullable
-- argument from a bare comparison and generates `*string` for a value the
-- caller always has. The cast is on the parameter, not on the column, so the
-- expression index still serves the predicate.
SELECT id, info_hash
  FROM torrents
 WHERE left(info_hash_v2, 40) = sqlc.arg(announced_hash)::text
   AND is_active = true
 LIMIT 1;
