-- Catch-up, part two: the columns `drizzle-kit push` added to tables the
-- migrations already knew about.
--
-- 0009a_schema_catchup covered the 24 tables no migration ever created. This
-- covers the other half of the same debt: 37 columns that only ever existed
-- because push diffed schema.ts against a live database — moderation status,
-- the external metadata ids, the bonus counters, the whole profile-preferences
-- block, 2FA. A fresh `drizzle-kit migrate` stopped 37 columns short of the
-- schema the code expects, which is a database the API cannot boot against.
--
-- Also drops the two columns the history creates and the current schema does
-- not want. 0009_roles_moderation introduced `torrents.is_approved` and
-- `users.role_id`; both were superseded (by `moderation_status` and the
-- `user_roles` table) and dropped from long-running databases by push, but the
-- migration that created them was never followed by one that removes them, so
-- a fresh install grew them back.
--
-- Types and defaults are read from a database push had brought to the current
-- schema.ts, so they match what the ORM expects rather than what a reviewer
-- guessed. Every statement is idempotent: this has to converge databases that
-- already hold most of these columns, not fail on the first one it meets.

-- ── Columns push added and no migration recorded ──────────────────
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "is_adult" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "type" text;
--> statement-breakpoint
ALTER TABLE "forum_categories" ADD COLUMN IF NOT EXISTS "color" text;
--> statement-breakpoint
ALTER TABLE "forum_categories" ADD COLUMN IF NOT EXISTS "icon" text;
--> statement-breakpoint
ALTER TABLE "hnr_tracking" ADD COLUMN IF NOT EXISTS "downloaded" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "hnr_tracking" ADD COLUMN IF NOT EXISTS "uploaded" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN IF NOT EXISTS "withdrawn_at" timestamp;
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "assignment_mode" text DEFAULT 'manual'::text NOT NULL;
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "icon" text;
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "priority" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "rules" jsonb;
--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "show_as_badge" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "site_stats" ADD COLUMN IF NOT EXISTS "total_uploaded_bytes" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "content_signature" text;
--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "episode" smallint;
--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "federate_swarm" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "imdb_id" text;
--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "moderated_at" timestamp;
--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "moderated_by_id" text;
--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "moderation_status" text DEFAULT 'pending'::text NOT NULL;
--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "nfo" text;
--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "season" smallint;
--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "tmdb_id" text;
--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "tvdb_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "banned_by_id" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "banned_by_role" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bio" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bonus_points" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "bonus_uploaded" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_name" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "language" text DEFAULT 'en'::text NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "show_adult_content" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "show_last_seen" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "theme" text DEFAULT 'dark'::text NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "trust_devices_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- ── Legacy columns the current schema no longer declares ─────────
ALTER TABLE "torrents" DROP COLUMN IF EXISTS "is_approved";
--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "role_id";
