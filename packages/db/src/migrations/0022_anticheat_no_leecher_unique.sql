-- Collapse open `no_leecher` flags to one row per (user, torrent).
--
-- Before this index, the tracker emitted one `anticheat_flags` row
-- per offending announce. A repeat-offender pattern (same user
-- pumping bytes against an empty swarm of the same torrent) could
-- fill the moderation queue with a hundred near-identical rows in
-- a single afternoon — drowning the actual signal.
--
-- The partial unique index restricts the dedup to the slice that
-- matters for triage: kind = 'no_leecher', not yet reviewed, and
-- the torrent is still resolvable (a null torrent means the announce
-- targeted an infohash we don't know — those stay distinct because
-- we can't prove they collapse to the same release).
--
-- The Go tracker's INSERT for this slice uses `ON CONFLICT … DO
-- UPDATE` to aggregate `details.deltaUp` and refresh the
-- swarm/peer fields instead of producing duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "anticheat_flags_no_leecher_open_unique"
  ON "anticheat_flags" ("user_id", "torrent_id")
  WHERE "kind" = 'no_leecher'
    AND "reviewed_at" IS NULL
    AND "torrent_id" IS NOT NULL;
