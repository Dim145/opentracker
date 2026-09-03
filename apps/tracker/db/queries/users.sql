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

-- name: BatchIncrementUserStats :exec
-- Versement groupé : applique en une requête les deltas accumulés pour une
-- TRANCHE de membres.
--
-- Pourquoi par tranches, et pas la totalité d'un versement en une requête :
-- une seule transaction qui met à jour des dizaines de milliers de lignes
-- empêche l'élagage HOT de recycler la place en page — les anciennes versions
-- restent vivantes jusqu'au commit, chaque ligne migre vers une nouvelle page
-- et réécrit les SEPT index. Mesuré : 45 317 lignes en une transaction tombent
-- à 19 % de HOT et écrivent PLUS de WAL que les 117 840 écritures unitaires
-- qu'elles remplacent. Par tranches de dix, on remonte à 100 % de HOT et le
-- WAL est divisé par quinze. La taille de tranche est réglable, le défaut
-- vient de cette mesure.
--
-- L'ordre des identifiants est celui que l'appelant fournit, et il les trie :
-- deux versements concurrents prendraient leurs verrous de ligne dans le même
-- ordre et ne peuvent donc pas s'interbloquer.
UPDATE users u
   SET uploaded   = u.uploaded   + d.up,
       downloaded = u.downloaded + d.down
  FROM (SELECT i.id, p.up, q.down
          FROM unnest(@ids::text[])    WITH ORDINALITY AS i(id, n)
          JOIN unnest(@ups::bigint[])  WITH ORDINALITY AS p(up, n)   USING (n)
          JOIN unnest(@downs::bigint[]) WITH ORDINALITY AS q(down, n) USING (n)) d
 WHERE u.id = d.id;
