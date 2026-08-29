CREATE TABLE "messaging_broadcasts" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by_id" text,
	"audience" text NOT NULL,
	"body" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pinned_message_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pinned_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pinned_by_id" text;--> statement-breakpoint
ALTER TABLE "messaging_broadcasts" ADD CONSTRAINT "messaging_broadcasts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messaging_broadcasts_created_idx" ON "messaging_broadcasts" USING btree ("created_at");