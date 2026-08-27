-- Taxonomy bridge: a partner's category slug → one of our local categories, so
-- the grouped browse filter can surface differently-named foreign categories and
-- the read paths can show a real name instead of the raw foreign slug. IF NOT
-- EXISTS / guarded so a database already carrying it converges.
CREATE TABLE IF NOT EXISTS "remote_category_map" (
	"id" text PRIMARY KEY NOT NULL,
	"remote_slug" text NOT NULL,
	"local_category_id" text NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remote_category_map_local_category_id_categories_id_fk') THEN
    ALTER TABLE "remote_category_map" ADD CONSTRAINT "remote_category_map_local_category_id_categories_id_fk" FOREIGN KEY ("local_category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'remote_category_map_created_by_users_id_fk') THEN
    ALTER TABLE "remote_category_map" ADD CONSTRAINT "remote_category_map_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "remote_category_map_slug_idx" ON "remote_category_map" USING btree ("remote_slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "remote_category_map_category_idx" ON "remote_category_map" USING btree ("local_category_id");
