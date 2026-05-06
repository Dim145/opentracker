-- name: FindUserByPasskey :one
-- Returns the columns the tracker needs to validate a passkey on every announce.
SELECT id, is_banned, uploaded, downloaded
  FROM users
 WHERE passkey = $1
 LIMIT 1;

-- name: IncrementUserStats :exec
-- Adds upload/download deltas to the user identified by passkey.
UPDATE users
   SET uploaded   = uploaded   + $1,
       downloaded = downloaded + $2
 WHERE passkey = $3;
