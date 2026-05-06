-- name: FindActiveTorrentByInfoHash :one
-- Returns the active torrent matching the given hex info_hash, or no rows
-- if either it doesn't exist or it's been deactivated.
SELECT id
  FROM torrents
 WHERE info_hash = $1
   AND is_active = true
 LIMIT 1;
