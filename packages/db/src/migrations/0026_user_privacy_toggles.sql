ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "anonymous_uploads" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hide_download_history" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "restrict_comments" boolean DEFAULT false NOT NULL;
