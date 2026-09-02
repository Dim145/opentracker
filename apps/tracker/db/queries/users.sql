-- name: FindUserByPasskey :one
-- Returns the columns the tracker needs to validate a passkey on every announce.
SELECT id, is_banned, uploaded, downloaded
  FROM users
 WHERE passkey = $1
 LIMIT 1;

-- name: IncrementUserStats :exec
-- Adds upload/download deltas to the user identified by ID.
--
-- Par l'ID, et non par la passkey. L'appelant a `user.ID` en main — il vient
-- d'un cache de 60 s indexé par le hachis de la passkey — et si la passkey a
-- changé entre la résolution et cette écriture (rotation depuis l'interface
-- web), l'`UPDATE` touchait ZÉRO ligne et le crédit disparaissait en silence.
-- `BumpUserTorrentBytes`, juste en dessous, utilise déjà l'ID.
UPDATE users
   SET uploaded   = uploaded   + $1,
       downloaded = downloaded + $2
 WHERE id = $3;
