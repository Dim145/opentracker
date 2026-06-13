CREATE TABLE IF NOT EXISTS "federation_catalog_removals" (
	"id" text PRIMARY KEY NOT NULL,
	"torrent_id" text NOT NULL,
	"info_hash" text NOT NULL,
	"content_signature" text,
	"reason" text NOT NULL,
	"removed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "federation_catalog_removals_cursor_idx" ON "federation_catalog_removals" USING btree ("removed_at","id");
