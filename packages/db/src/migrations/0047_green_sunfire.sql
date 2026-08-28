CREATE TABLE "uploaded_fonts" (
	"id" text PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"role" text NOT NULL,
	"storage_key" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uploaded_fonts_sha256_unique" UNIQUE("sha256"),
	CONSTRAINT "uploaded_fonts_role_ck" CHECK ("uploaded_fonts"."role" IN ('sans', 'mono', 'display'))
);
--> statement-breakpoint
ALTER TABLE "uploaded_fonts" ADD CONSTRAINT "uploaded_fonts_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uploaded_fonts_role_idx" ON "uploaded_fonts" USING btree ("role");