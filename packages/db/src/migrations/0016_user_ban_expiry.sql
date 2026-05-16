-- Time-limited bans. Bans were permanent up to this point: the
-- `users.is_banned` flag was either on (account dead) or off. Now a
-- ban can carry an expiry, and a reason string the banned user sees
-- on their bounce screen.
--
-- `banned_until` is nullable on purpose:
--   * null + is_banned=true  → permanent ban (historical behaviour)
--   * timestamp              → ban auto-lifts at that moment
--   * is_banned=false        → not banned (the timestamp may linger
--     after a manual unban; we don't bother clearing it)
ALTER TABLE "users"
  ADD COLUMN "banned_until" timestamp,
  ADD COLUMN "ban_reason"   text;

-- The ban-expiry cron scans on this index every 5 min. Partial so it
-- only carries rows that are actually banned with a timestamp — keeps
-- the index lean (most users never get banned, and permanent bans
-- never appear here either).
CREATE INDEX "users_banned_until_idx"
  ON "users" ("banned_until")
  WHERE "is_banned" = true AND "banned_until" IS NOT NULL;
