-- name: FindActiveTorrentByInfoHash :one
-- Returns the active torrent matching the given hex info_hash, or no rows
-- if either it doesn't exist or it's been deactivated.
--
-- The two multipliers come back with it, already neutralised when the buff has
-- lapsed. Doing that here rather than in Go is what keeps the announce path
-- free of clock logic AND free of a sweep that has to run on time: a buff
-- expires the moment its timestamp passes, whether or not anything noticed.
SELECT id,
       CASE WHEN multipliers_until IS NULL OR multipliers_until > now()
            THEN download_multiplier ELSE 100 END AS download_multiplier,
       CASE WHEN multipliers_until IS NULL OR multipliers_until > now()
            THEN upload_multiplier   ELSE 100 END AS upload_multiplier
  FROM torrents
 WHERE info_hash = $1
   AND is_active = true
   -- Le chemin d'annonce est la SEULE application qu'un refus de modération
   -- possède. `is_active` est un interrupteur d'opérateur et `transitionStatus`
   -- ne le touche jamais : filtrer sur lui seul laissait une release REFUSÉE
   -- continuer à distribuer des pairs, à créditer du ratio et à créer des
   -- lignes de hit-and-run. Une ligne refusée est conservée pour que le même
   -- infohash ne puisse pas être renvoyé en silence ; elle n'a pas à rester
   -- annonçable pour autant. Idem pour tout ce qui attend encore une
   -- validation.
   AND moderation_status = 'accepted'
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
SELECT id, info_hash,
       CASE WHEN multipliers_until IS NULL OR multipliers_until > now()
            THEN download_multiplier ELSE 100 END AS download_multiplier,
       CASE WHEN multipliers_until IS NULL OR multipliers_until > now()
            THEN upload_multiplier   ELSE 100 END AS upload_multiplier
  FROM torrents
 WHERE left(info_hash_v2, 40) = sqlc.arg(announced_hash)::text
   AND is_active = true
   -- Même filtre que le chemin v1 ci-dessus : le second essaim d'un torrent
   -- hybride n'est pas une porte de service.
   AND moderation_status = 'accepted'
 LIMIT 1;
