CREATE TABLE "themes" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base" text DEFAULT 'dark' NOT NULL,
	"tokens" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom_css" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"visibility" text DEFAULT 'site' NOT NULL,
	"required_roles" jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "themes_slug_unique" UNIQUE("slug"),
	CONSTRAINT "themes_visibility_ck" CHECK (("themes"."visibility" = 'site' AND "themes"."required_roles" IS NULL)
          OR ("themes"."visibility" = 'roles' AND jsonb_array_length("themes"."required_roles") > 0)),
	CONSTRAINT "themes_base_ck" CHECK ("themes"."base" IN ('light', 'dark'))
);
--> statement-breakpoint
ALTER TABLE "themes" ADD CONSTRAINT "themes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "themes_enabled_idx" ON "themes" USING btree ("enabled","position");