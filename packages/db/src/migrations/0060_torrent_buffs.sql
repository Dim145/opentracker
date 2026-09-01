ALTER TABLE "torrents" ADD COLUMN "download_multiplier" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN "upload_multiplier" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN "multipliers_until" timestamp;--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN "is_sticky" boolean DEFAULT false NOT NULL;