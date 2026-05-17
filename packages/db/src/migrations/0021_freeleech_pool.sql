-- Freeleech pool — contributory site-wide freeleech.
--
-- Users pool their bonus points into a shared pot; when the target
-- is reached the system spawns a `bonus_events` row whose `source`
-- column flags it as `freeleech_pool`, runs the freeleech for a
-- configured number of days, then drains the pool and reopens a new
-- cycle.
--
-- See packages/db/src/schema.ts for the design rationale; this file
-- captures the same shape as raw SQL so an operator running explicit
-- migrations (instead of `drizzle-kit push --force` at boot) lands on
-- the same physical schema.

-- 1. Bonus events get a `source` column so the icon / modal can
--    distinguish admin-created windows from pool-triggered ones.
ALTER TABLE "bonus_events"
  ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'manual';

-- 2. Singleton config table. Locked to `id = 1` by a partial unique
--    index — belt-and-braces alongside the upsert in the admin route.
CREATE TABLE IF NOT EXISTS "freeleech_pool_config" (
  "id"                              integer PRIMARY KEY,
  "enabled"                         boolean   NOT NULL DEFAULT false,
  "points_target"                   integer   NOT NULL DEFAULT 0,
  "freeleech_duration_days"         integer   NOT NULL DEFAULT 1,
  "contribution_min"                integer   NOT NULL DEFAULT 1,
  "max_per_user_bp"                 integer   NOT NULL DEFAULT 0,
  "preset_amounts"                  jsonb     NOT NULL DEFAULT '[]'::jsonb,
  "event_title_template"            text,
  "event_description_template"      text,
  "event_long_description_template" text,
  "updated_at"                      timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "freeleech_pool_config_singleton"
  ON "freeleech_pool_config" ("id")
  WHERE "id" = 1;

-- 3. Optional contribution windows. Empty table → pool always open
--    (subject to the `enabled` flag); otherwise contributions only
--    accepted when *now* falls inside at least one window.
--
--    Four kinds:
--      'oneoff'  — concrete [starts_at, ends_at) range
--      'weekly'  — weekday + time-of-day bounds
--      'monthly' — list of days-of-month + time-of-day bounds
--      'yearly'  — anniversary range (month/day for both ends)
CREATE TABLE IF NOT EXISTS "freeleech_pool_windows" (
  "id"                text PRIMARY KEY,
  "kind"              text NOT NULL,
  "enabled"           boolean NOT NULL DEFAULT true,
  -- oneoff
  "starts_at"         timestamp,
  "ends_at"           timestamp,
  -- weekly + monthly (time-of-day fields shared between the two)
  "weekday_start"     integer,    -- 0-6 (0 = Sun)
  "weekday_end"       integer,    -- 0-6
  "minute_start"      integer,    -- 0-1440 UTC
  "minute_end"        integer,    -- 0-1440 UTC
  -- monthly
  "monthly_days"      jsonb,      -- array of int 1-31
  -- yearly (whole-day anniversary range, can cross Dec 31)
  "year_month_start"  integer,    -- 1-12
  "year_day_start"    integer,    -- 1-31
  "year_month_end"    integer,    -- 1-12
  "year_day_end"      integer,    -- 1-31
  "label"             text,
  "created_at"        timestamp NOT NULL DEFAULT NOW()
);

-- 3b. Rename historical 'recurring' rows so they line up with the
--     new 'weekly' / 'monthly' / 'yearly' split. `kind` carried
--     'recurring' for weekly rows in the pre-split design; the
--     monthly/yearly columns didn't exist then.
ALTER TABLE "freeleech_pool_windows"
  ADD COLUMN IF NOT EXISTS "monthly_days"     jsonb,
  ADD COLUMN IF NOT EXISTS "year_month_start" integer,
  ADD COLUMN IF NOT EXISTS "year_day_start"   integer,
  ADD COLUMN IF NOT EXISTS "year_month_end"   integer,
  ADD COLUMN IF NOT EXISTS "year_day_end"     integer;

UPDATE "freeleech_pool_windows" SET "kind" = 'weekly' WHERE "kind" = 'recurring';

CREATE INDEX IF NOT EXISTS "freeleech_pool_windows_kind_idx"
  ON "freeleech_pool_windows" ("kind", "enabled");

CREATE INDEX IF NOT EXISTS "freeleech_pool_windows_oneoff_idx"
  ON "freeleech_pool_windows" ("starts_at", "ends_at");

-- 4. Cycle ledger — one row per fill→trigger→end.
--    Status: 'filling' | 'full_queued' | 'active' | 'ended' | 'cancelled'.
--    A partial unique index keeps at most one open row at any time.
CREATE TABLE IF NOT EXISTS "freeleech_pool_cycles" (
  "id"                                text PRIMARY KEY,
  "status"                            text NOT NULL DEFAULT 'filling',
  "target_snapshot"                   integer NOT NULL,
  "duration_days_snapshot"            integer NOT NULL,
  "total_contributed"                 integer NOT NULL DEFAULT 0,
  "started_at"                        timestamp,
  "ends_at"                           timestamp,
  "triggered_event_id"                text REFERENCES "bonus_events"("id") ON DELETE SET NULL,
  "paused_event_title"                text,
  "paused_event_description"          text,
  "paused_event_long_description"     text,
  "paused_event_download_multiplier"  integer,
  "paused_event_upload_multiplier"    integer,
  "paused_event_remaining_ms"         bigint,
  "paused_event_created_by_id"        text REFERENCES "users"("id") ON DELETE SET NULL,
  "waiting_on_event_id"               text REFERENCES "bonus_events"("id") ON DELETE SET NULL,
  "created_at"                        timestamp NOT NULL DEFAULT NOW(),
  "closed_at"                         timestamp
);

CREATE INDEX IF NOT EXISTS "freeleech_pool_cycles_status_idx"
  ON "freeleech_pool_cycles" ("status", "created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "freeleech_pool_cycles_open_unique"
  ON "freeleech_pool_cycles" ("status")
  WHERE "status" IN ('filling', 'full_queued', 'active');

-- 5. Append-only contribution ledger. We never merge rows for the
--    same (cycle, user) so the audit + per-user cap check stay honest.
CREATE TABLE IF NOT EXISTS "freeleech_pool_contributions" (
  "id"          text PRIMARY KEY,
  "cycle_id"    text NOT NULL REFERENCES "freeleech_pool_cycles"("id") ON DELETE CASCADE,
  "user_id"     text NOT NULL REFERENCES "users"("id")                ON DELETE CASCADE,
  "amount"      integer NOT NULL,
  "created_at"  timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "freeleech_pool_contributions_cycle_idx"
  ON "freeleech_pool_contributions" ("cycle_id", "created_at");

CREATE INDEX IF NOT EXISTS "freeleech_pool_contributions_cycle_user_idx"
  ON "freeleech_pool_contributions" ("cycle_id", "user_id");
