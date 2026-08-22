CREATE TABLE IF NOT EXISTS "announce_log" (
	"id" text PRIMARY KEY NOT NULL,
	"info_hash" text NOT NULL,
	"peer_id" text NOT NULL,
	"event" text,
	"ip" text NOT NULL,
	"port" integer NOT NULL,
	"uploaded" bigint DEFAULT 0 NOT NULL,
	"downloaded" bigint DEFAULT 0 NOT NULL,
	"left" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "torrent_stats" (
	"info_hash" text PRIMARY KEY NOT NULL,
	"seeders" integer DEFAULT 0 NOT NULL,
	"leechers" integer DEFAULT 0 NOT NULL,
	"completed" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "torrents" (
	"id" text PRIMARY KEY NOT NULL,
	"info_hash" text NOT NULL,
	"name" text NOT NULL,
	"size" bigint NOT NULL,
	"torrent_data" "bytea",
	"uploader_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "torrents_info_hash_unique" UNIQUE("info_hash")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"passkey" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_passkey_unique" UNIQUE("passkey")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'torrent_stats_info_hash_torrents_info_hash_fk' AND conrelid = 'public.torrent_stats'::regclass) THEN
    ALTER TABLE "torrent_stats" ADD CONSTRAINT "torrent_stats_info_hash_torrents_info_hash_fk" FOREIGN KEY ("info_hash") REFERENCES "public"."torrents"("info_hash") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'torrents_uploader_id_users_id_fk' AND conrelid = 'public.torrents'::regclass) THEN
    ALTER TABLE "torrents" ADD CONSTRAINT "torrents_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announce_log_info_hash_idx" ON "announce_log" USING btree ("info_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announce_log_created_at_idx" ON "announce_log" USING btree ("created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "torrents_info_hash_idx" ON "torrents" USING btree ("info_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "torrents_uploader_idx" ON "torrents" USING btree ("uploader_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_passkey_idx" ON "users" USING btree ("passkey");
