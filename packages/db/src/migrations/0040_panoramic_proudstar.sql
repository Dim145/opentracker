-- BitTorrent v2 (BEP 52) content addressing on both catalogues. `info_hash_v2`
-- is the v2/hybrid infohash; `content_root_v2` is the cross-tracker content key
-- (see utils/bittorrentV2), indexed because it drives cross-seed / fill matching
-- joins. All nullable — a v1-only torrent carries neither. IF NOT EXISTS guarded
-- so a database already carrying them converges.
ALTER TABLE "remote_torrents" ADD COLUMN IF NOT EXISTS "info_hash_v2" text;--> statement-breakpoint
ALTER TABLE "remote_torrents" ADD COLUMN IF NOT EXISTS "content_root_v2" text;--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "info_hash_v2" text;--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN IF NOT EXISTS "content_root_v2" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remote_torrents_content_root_v2_idx" ON "remote_torrents" USING btree ("content_root_v2");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "torrents_content_root_v2_idx" ON "torrents" USING btree ("content_root_v2");
