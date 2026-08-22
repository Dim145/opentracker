-- Local moderation of federated content: a mask hides a mirrored release from
-- every read path without touching the peer or the record. IF NOT EXISTS /
-- guarded so a database already carrying it converges.
CREATE TABLE IF NOT EXISTS "remote_masks" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remote_masks_created_by_users_id_fk') THEN
    ALTER TABLE "remote_masks" ADD CONSTRAINT "remote_masks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "remote_masks_scope_value_idx" ON "remote_masks" USING btree ("scope","value");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remote_masks_value_idx" ON "remote_masks" USING btree ("value");
