-- Presentation templates: the user-authored / site-curated BBCode layouts the
-- /torrents/fiche wizard renders a listing from. Merged in from the templates
-- feature; on that branch it arrived as two migrations (create, then make
-- site-owned templates possible), collapsed here into the final shape because
-- this branch's chain had already moved past those numbers. The one data step
-- there (converting 'published' rows to 'site') was a documented no-op outside
-- the feature branch, so nothing is lost.
--
--   * owner_id nullable: a site template belongs to the site and outlives the
--     admin who added it; a member's template keeps an owner and cascades away
--     with the account.
--   * created_by ON DELETE SET NULL: who added a site template.
--   * two partial indexes (site listing, one-default-per-owner) and a CHECK
--     pinning the two legal shapes — none of which `push` can produce, so they
--     only exist on databases that went through this chain.
--
-- IF NOT EXISTS / guarded so a database joining partway converges.
CREATE TABLE IF NOT EXISTS "presentation_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text,
	"created_by" text,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'universal' NOT NULL,
	"content" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "presentation_templates_scope_ck" CHECK (("presentation_templates"."visibility" = 'private' AND "presentation_templates"."owner_id" IS NOT NULL)
          OR ("presentation_templates"."visibility" = 'site' AND "presentation_templates"."owner_id" IS NULL AND "presentation_templates"."is_default" = false))
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'presentation_templates_owner_id_users_id_fk') THEN
    ALTER TABLE "presentation_templates" ADD CONSTRAINT "presentation_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'presentation_templates_created_by_users_id_fk') THEN
    ALTER TABLE "presentation_templates" ADD CONSTRAINT "presentation_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presentation_templates_owner_idx" ON "presentation_templates" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presentation_templates_site_idx" ON "presentation_templates" USING btree ("category","created_at") WHERE "presentation_templates"."visibility" = 'site';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "presentation_templates_default_unique" ON "presentation_templates" USING btree ("owner_id") WHERE "presentation_templates"."is_default";
