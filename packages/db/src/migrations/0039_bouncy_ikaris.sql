-- Account erasure (GDPR right to erasure). Two changes:
--   * users.deleted_at — the gate the cached auth check reads to refuse an
--     erased (anonymised) account like a missing one.
--   * torrents.uploader_id ON DELETE SET NULL — a torrent must outlive its
--     uploader; the old constraint (NO ACTION) made a member with one release
--     undeletable. Drop-then-add converts it in place on a database already
--     carrying the old form. IF NOT EXISTS / IF EXISTS guarded so a database
--     that already matches converges.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "torrents" DROP CONSTRAINT IF EXISTS "torrents_uploader_id_users_id_fk";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'torrents_uploader_id_users_id_fk') THEN
    ALTER TABLE "torrents" ADD CONSTRAINT "torrents_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
