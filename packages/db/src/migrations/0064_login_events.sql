CREATE TABLE "login_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"username" text NOT NULL,
	"method" text NOT NULL,
	"outcome" text NOT NULL,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "login_events_user_idx" ON "login_events" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "login_events_created_idx" ON "login_events" USING btree ("created_at" DESC NULLS LAST);