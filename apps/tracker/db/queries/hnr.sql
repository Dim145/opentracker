-- name: CreateHnrEntry :exec
-- Inserts a new hit-and-run row when a user completes a torrent for the
-- first time. Idempotent thanks to the (user_id, torrent_id) UNIQUE.
INSERT INTO hnr_tracking (
    id, user_id, torrent_id,
    downloaded_at, seed_time, required_seed_time,
    is_hnr, is_exempt
)
VALUES ($1, $2, $3, NOW(), 0, $4, false, false)
ON CONFLICT (user_id, torrent_id) DO NOTHING;

-- name: AddSeedTime :exec
-- Adds `additional` seconds to a peer's seed time. If the cumulative total
-- crosses required_seed_time the row is also stamped completed_at = NOW()
-- and is_hnr cleared, all in one atomic UPDATE.
UPDATE hnr_tracking
   SET seed_time    = seed_time + $1,
       completed_at = CASE
         WHEN completed_at IS NULL
          AND seed_time + $1 >= required_seed_time
         THEN NOW()
         ELSE completed_at
       END,
       is_hnr       = CASE
         WHEN completed_at IS NULL
          AND seed_time + $1 >= required_seed_time
         THEN false
         ELSE is_hnr
       END
 WHERE user_id = $2
   AND torrent_id = $3
   AND is_exempt = false
   AND completed_at IS NULL;

-- name: FindUserAndTorrentByPasskeyAndHash :one
-- Resolves (passkey, info_hash) to (user_id, torrent_id). Used right
-- before HnR writes so we don't have to round-trip twice.
SELECT u.id AS user_id, t.id AS torrent_id
  FROM users u, torrents t
 WHERE u.passkey = $1
   AND t.info_hash = $2
   AND t.is_active = true
 LIMIT 1;

-- name: BumpUserTorrentBytes :execrows
-- Fast path on every announce: increment the byte totals for an
-- existing (user, torrent) pair. Returns the row count so the caller
-- can fall through to InsertUserTorrentBytes when the row hasn't been
-- created yet (rare — the API stamps a row on the first .torrent
-- download, and the tracker's own HnR completion path also creates
-- one). Plain UPDATE costs no crypto-rand, no constraint check, no
-- dead-tuple churn — the previous INSERT … ON CONFLICT path paid all
-- of those on every single announce.
UPDATE hnr_tracking
   SET uploaded   = uploaded   + $1,
       downloaded = downloaded + $2
 WHERE user_id    = $3
   AND torrent_id = $4;

-- name: InsertUserTorrentBytes :exec
-- Cold path used only when BumpUserTorrentBytes touched zero rows —
-- typically the very first delta we receive for a user×torrent pair
-- when there's no .torrent-click stamp yet. ON CONFLICT DO NOTHING
-- keeps the call race-safe against a concurrent first-announce.
INSERT INTO hnr_tracking (
    id, user_id, torrent_id, downloaded_at,
    seed_time, required_seed_time,
    is_hnr, is_exempt,
    uploaded, downloaded
)
VALUES ($1, $2, $3, NOW(), 0, $4, false, false, $5, $6)
ON CONFLICT (user_id, torrent_id) DO NOTHING;
