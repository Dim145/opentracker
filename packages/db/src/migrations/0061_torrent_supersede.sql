ALTER TABLE "torrents" ADD COLUMN "superseded_by_id" text;--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN "superseded_at" timestamp;--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN "supersede_reason" text;--> statement-breakpoint
ALTER TABLE "torrents" ADD CONSTRAINT "torrents_superseded_by_id_torrents_id_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."torrents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "torrents_superseded_by_idx" ON "torrents" USING btree ("superseded_by_id") WHERE "torrents"."superseded_by_id" IS NOT NULL;