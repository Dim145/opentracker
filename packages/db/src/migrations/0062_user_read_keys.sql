ALTER TABLE "users" ADD COLUMN "rss_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "api_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_rss_key_unique" UNIQUE("rss_key");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_api_key_unique" UNIQUE("api_key");