-- Federated origin on upload_requests (M1 request→fill bridge): where a request
-- was seen, its infohash (dedup + display), and the v2 content root that proves a
-- fill is the same content. All nullable — a plain local request carries none.
-- IF NOT EXISTS / guarded so a database already carrying them converges.
ALTER TABLE "upload_requests" ADD COLUMN IF NOT EXISTS "federated_peer_id" text;--> statement-breakpoint
ALTER TABLE "upload_requests" ADD COLUMN IF NOT EXISTS "federated_info_hash" text;--> statement-breakpoint
ALTER TABLE "upload_requests" ADD COLUMN IF NOT EXISTS "federated_content_root_v2" text;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upload_requests_federated_peer_id_federation_peers_id_fk') THEN
    ALTER TABLE "upload_requests" ADD CONSTRAINT "upload_requests_federated_peer_id_federation_peers_id_fk" FOREIGN KEY ("federated_peer_id") REFERENCES "public"."federation_peers"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_requests_federated_info_hash_idx" ON "upload_requests" USING btree ("federated_info_hash");
