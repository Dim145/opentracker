-- name: GetSetting :one
-- Returns the raw string value for a settings key, or no rows if unset.
-- The tracker layers a TTL cache on top of this — see internal/db/cache.go.
SELECT value
  FROM settings
 WHERE key = $1
 LIMIT 1;
