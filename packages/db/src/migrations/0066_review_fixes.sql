ALTER TABLE "saved_searches" DROP CONSTRAINT "saved_searches_category_id_categories_id_fk";
--> statement-breakpoint
ALTER TABLE "torrents" ALTER COLUMN "multipliers_until" SET DATA TYPE timestamp with time zone USING "multipliers_until" AT TIME ZONE 'UTC';--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hnr_downloaded_at_idx" ON "hnr_tracking" USING btree ("downloaded_at");--> statement-breakpoint
CREATE INDEX "hnr_completed_at_idx" ON "hnr_tracking" USING btree ("completed_at");--> statement-breakpoint
CREATE INDEX "torrent_stats_completed_idx" ON "torrent_stats" USING btree ("completed" desc);--> statement-breakpoint
CREATE INDEX "torrent_stats_seeders_idx" ON "torrent_stats" USING btree ("seeders" desc);--> statement-breakpoint
CREATE INDEX "torrents_created_at_idx" ON "torrents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "torrents_sticky_idx" ON "torrents" USING btree ("is_sticky") WHERE "torrents"."is_sticky";--> statement-breakpoint
ALTER TABLE "torrents" ADD CONSTRAINT "torrents_multipliers_sane" CHECK ("torrents"."download_multiplier" between 0 and 200 and "torrents"."upload_multiplier" between 0 and 1000);