ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "updated_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "torrents_updated_at_idx" ON "torrents" USING btree ("updated_at");
