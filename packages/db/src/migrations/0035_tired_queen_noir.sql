-- Federation review fixes: the reputation-consent opt-in and the mint cursor
-- index. IF NOT EXISTS so a database already carrying them (pushed the current
-- schema before the switch to migrations) converges rather than failing.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "share_reputation_federated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "torrents_mint_cursor_idx" ON "torrents" USING btree (coalesce("updated_at", "created_at"),"id");
