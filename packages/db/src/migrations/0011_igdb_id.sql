-- Add igdb_id column + index to torrents for the new IGDB metadata
-- source (video games). categories.type is already a free-text
-- column so 'game' is a valid value with no schema change there.
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "igdb_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "torrents_igdb_idx" ON "torrents" ("igdb_id");
