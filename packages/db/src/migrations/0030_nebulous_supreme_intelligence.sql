-- Presentation templates: the user-authored BBCode templates that drive the
-- /torrents/fiche listing generator. One table, no seed row — the built-in
-- default template is a code constant, so there is nothing to insert here and
-- nothing an operator can accidentally delete.
--
-- Two of the three indexes are partial and cannot be produced by push (which
-- creates no secondary indexes at all), so they only exist on databases that
-- went through this chain:
--   * presentation_templates_published_idx narrows to the handful of
--     staff-published rows inside a table that is otherwise private drafts.
--   * presentation_templates_default_unique is the structural form of "one
--     default template per owner" — the endpoint clears the previous holder
--     in the same transaction, this makes forgetting impossible.
--
-- Made idempotent to match the rest of the chain: a database joining partway
-- has to tolerate re-running what it already holds.

CREATE TABLE IF NOT EXISTS "presentation_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text DEFAULT 'universal' NOT NULL,
	"content" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "presentation_templates" DROP CONSTRAINT IF EXISTS "presentation_templates_owner_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "presentation_templates" ADD CONSTRAINT "presentation_templates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presentation_templates_owner_idx" ON "presentation_templates" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presentation_templates_published_idx" ON "presentation_templates" USING btree ("category","created_at") WHERE "presentation_templates"."visibility" = 'published';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "presentation_templates_default_unique" ON "presentation_templates" USING btree ("owner_id") WHERE "presentation_templates"."is_default";
