-- The signed catalogue: records, the identities that sign them, and where each
-- record can be got from.
--
-- Written to be safe on a database that already holds some of this. The boot
-- step used to be `drizzle-kit push`, and any instance that ran this branch
-- before the switch to migrations already has these tables — created by push,
-- which means with their columns and primary keys but WITHOUT their secondary
-- indexes or foreign keys. So each object is created only if absent, and the
-- indexes and keys below are what such a database is actually missing.
--
-- Sixteen indexes here, and one of them is not an optimisation:
-- `user_signing_keys_current` is a partial unique index enforcing one live
-- key per member. Under push it would never have existed, and nothing would
-- have stopped a member holding two.

CREATE TABLE IF NOT EXISTS "catalog_records" (
	"id" text PRIMARY KEY NOT NULL,
	"torrent_id" text,
	"info_hash" text,
	"issuer" text NOT NULL,
	"kind" text DEFAULT 'torrent' NOT NULL,
	"origin" text DEFAULT 'local' NOT NULL,
	"hops" integer DEFAULT 0 NOT NULL,
	"body" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"supersedes" text,
	"superseded_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "record_sources" (
	"record_id" text NOT NULL,
	"peer_id" text NOT NULL,
	"kind" text DEFAULT 'torrent' NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "record_sources_peer_id_record_id_pk" PRIMARY KEY("peer_id","record_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "remote_identity_links" (
	"id" text PRIMARY KEY NOT NULL,
	"peer_id" text NOT NULL,
	"issuer" text NOT NULL,
	"subject_did" text NOT NULL,
	"alias_did" text NOT NULL,
	"evidence" jsonb,
	"record_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "revoked_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"did" text NOT NULL,
	"issuer" text NOT NULL,
	"succeeded_by" text,
	"record_id" text,
	"revoked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_signing_keys" (
	"did" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"public_key" text NOT NULL,
	"private_key_enc" text,
	"revoked_at" timestamp,
	"succeeded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "federated_identities" ADD COLUMN IF NOT EXISTS "method" text DEFAULT 'bio' NOT NULL;--> statement-breakpoint
ALTER TABLE "federated_identities" ADD COLUMN IF NOT EXISTS "subject_did" text;--> statement-breakpoint
ALTER TABLE "federated_identities" ADD COLUMN IF NOT EXISTS "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "federation_config" ADD COLUMN IF NOT EXISTS "relay_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_config" ADD COLUMN IF NOT EXISTS "discoverable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "remote_torrents" ADD COLUMN IF NOT EXISTS "record_id" text;--> statement-breakpoint
ALTER TABLE "remote_torrents" ADD COLUMN IF NOT EXISTS "issuer" text;--> statement-breakpoint
ALTER TABLE "remote_torrents" ADD COLUMN IF NOT EXISTS "author_did" text;--> statement-breakpoint
ALTER TABLE "remote_torrents" ADD COLUMN IF NOT EXISTS "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'record_sources_peer_id_federation_peers_id_fk') THEN
    ALTER TABLE "record_sources" ADD CONSTRAINT "record_sources_peer_id_federation_peers_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."federation_peers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remote_identity_links_peer_id_federation_peers_id_fk') THEN
    ALTER TABLE "remote_identity_links" ADD CONSTRAINT "remote_identity_links_peer_id_federation_peers_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."federation_peers"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_signing_keys_user_id_users_id_fk') THEN
    ALTER TABLE "user_signing_keys" ADD CONSTRAINT "user_signing_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_records_info_hash_idx" ON "catalog_records" USING btree ("info_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_records_created_idx" ON "catalog_records" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_records_relayable_idx" ON "catalog_records" USING btree ("origin","hops");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_records_live_idx" ON "catalog_records" USING btree ("id") WHERE superseded_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_records_current_idx" ON "catalog_records" USING btree ("torrent_id") WHERE superseded_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_sources_record_idx" ON "record_sources" USING btree ("record_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "remote_identity_links_unique" ON "remote_identity_links" USING btree ("peer_id","subject_did","alias_did");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remote_identity_links_subject_idx" ON "remote_identity_links" USING btree ("subject_did");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remote_identity_links_alias_idx" ON "remote_identity_links" USING btree ("alias_did");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "revoked_identities_unique" ON "revoked_identities" USING btree ("issuer","did");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "revoked_identities_did_idx" ON "revoked_identities" USING btree ("did");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_signing_keys_current" ON "user_signing_keys" USING btree ("user_id") WHERE revoked_at IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_signing_keys_user_idx" ON "user_signing_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remote_torrents_record_idx" ON "remote_torrents" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remote_torrents_author_idx" ON "remote_torrents" USING btree ("author_did");