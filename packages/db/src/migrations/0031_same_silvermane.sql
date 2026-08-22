-- Presentation templates: publishing removed, site templates added.
--
-- A member could previously make their own template site-wide (gated on a
-- staff role). That is gone: members own private templates only, and the
-- catalogue everybody sees is curated on the admin screen instead. The column
-- keeps its name but not its vocabulary — 'published' becomes 'site', because
-- nobody publishes anything any more and the value now says where the template
-- comes from rather than what its author did.
--
-- Three structural consequences:
--   * owner_id becomes nullable. A site template belongs to the site, so it
--     must outlive the admin who added it; members' templates keep an owner
--     and still cascade away with the account, leaving no orphan drafts.
--   * created_by records who added a site template, ON DELETE SET NULL. It is
--     the only trace of a staff action anywhere in this schema.
--   * a CHECK pins the two legal shapes, so no future codepath can invent a
--     third (an owned site template, or a site template flagged as somebody's
--     personal default).
--
-- The data step converts any row that was published into a site template. It
-- has to run BEFORE the constraint or the constraint cannot be added: a
-- published row has an owner, which neither branch of the CHECK allows. Such a
-- row also loses `is_default`, so whoever had published their own default falls
-- back to the built-in layout — publishing never shipped outside this branch,
-- so in practice this updates nothing.
--
-- Idempotent like the rest of the chain: a database joining partway has to
-- tolerate re-running what it already holds.

UPDATE "presentation_templates"
   SET "visibility" = 'site', "owner_id" = NULL, "is_default" = false
 WHERE "visibility" = 'published';--> statement-breakpoint
DROP INDEX IF EXISTS "presentation_templates_published_idx";--> statement-breakpoint
ALTER TABLE "presentation_templates" ALTER COLUMN "owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "presentation_templates" ADD COLUMN IF NOT EXISTS "created_by" text;--> statement-breakpoint
ALTER TABLE "presentation_templates" DROP CONSTRAINT IF EXISTS "presentation_templates_created_by_users_id_fk";--> statement-breakpoint
ALTER TABLE "presentation_templates" ADD CONSTRAINT "presentation_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presentation_templates_site_idx" ON "presentation_templates" USING btree ("category","created_at") WHERE "presentation_templates"."visibility" = 'site';--> statement-breakpoint
ALTER TABLE "presentation_templates" DROP CONSTRAINT IF EXISTS "presentation_templates_scope_ck";--> statement-breakpoint
ALTER TABLE "presentation_templates" ADD CONSTRAINT "presentation_templates_scope_ck" CHECK (("presentation_templates"."visibility" = 'private' AND "presentation_templates"."owner_id" IS NOT NULL)
          OR ("presentation_templates"."visibility" = 'site' AND "presentation_templates"."owner_id" IS NULL AND "presentation_templates"."is_default" = false));
