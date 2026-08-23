-- Write amplification on the announce path: index hygiene plus physical
-- tuning of the three tables the tracker updates.
--
-- Measured on a running instance before this change (pg_stat_user_tables):
--
--   users            11134 updates,  74.0% HOT,  4 indexes
--   hnr_tracking      9424 updates,  99.5% HOT,  6 indexes
--   anticheat_flags   4255 updates,  96.8% HOT,  5 indexes
--
-- No counter column is indexed, so HOT updates are possible in principle. What
-- stopped them on `users` was `fillfactor` sitting at the default 100: with no
-- free space reserved in a page, the first update that does not fit moves the
-- row and rewrites all four indexes. 26% of updates were paying that.
--
-- Idempotent like the rest of the chain.

-- ── Index hygiene ────────────────────────────────────────────────────────────

-- Two IDENTICAL unique indexes existed on users(passkey): one from the
-- column's `.unique()`, one from an explicit uniqueIndex() in schema.ts. Both
-- were maintained on every write that touched the column, and either alone
-- answers every query the other could.
DROP INDEX IF EXISTS "users_passkey_idx";--> statement-breakpoint

-- (user_id) is a leading prefix of both hnr_user_torrent_idx and
-- hnr_user_is_hnr_idx, so Postgres serves a user_id-only lookup from either.
-- Pure write amplification on a table updated once per announce.
DROP INDEX IF EXISTS "hnr_user_idx";--> statement-breakpoint

-- `is_hnr` is a boolean and the interesting side is the rare one. A full index
-- spends most of its pages describing rows nobody queries, and every announce
-- that updates a tracking row maintains them.
DROP INDEX IF EXISTS "hnr_status_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hnr_status_idx" ON "hnr_tracking" USING btree ("is_hnr") WHERE "hnr_tracking"."is_hnr";--> statement-breakpoint

-- ── Physical tuning ─────────────────────────────────────────────────────────

-- fillfactor on `users` ONLY. hnr_tracking and anticheat_flags already run at
-- 99.5% and 96.8% HOT, so reserving space there would trade disk for nothing —
-- tuning a number that is already right is how a schema accumulates cargo.
--
-- 85 rather than 70: a users row is wide (33 columns), so a page holds few of
-- them and 15% is already room for several in-page versions. Too low and the
-- table grows for no gain.
--
-- NOTE FOR OPERATORS: fillfactor applies to pages written from now on. Existing
-- pages keep their current packing until the table is rewritten — `pg_repack`
-- (online) or `VACUUM FULL` (takes an ACCESS EXCLUSIVE lock, so a maintenance
-- window). This migration deliberately does NOT rewrite: a boot-time migration
-- must not take an exclusive lock on `users`.
ALTER TABLE "users" SET (fillfactor = 85);--> statement-breakpoint

-- Autovacuum, on the three tables the announce path churns. The defaults wait
-- for 20% of the table to be dead tuples; on 350 000 users that is 70 000 dead
-- versions before a vacuum starts, by which point the bloat is already paid
-- for. 2% keeps it continuous and cheap instead of rare and expensive.
--
-- analyze at 5%: the planner's row estimates on these tables barely move, so
-- there is no reason to re-sample as often as we vacuum.
ALTER TABLE "users" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.05);--> statement-breakpoint
ALTER TABLE "hnr_tracking" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.05);--> statement-breakpoint
ALTER TABLE "anticheat_flags" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.05);
