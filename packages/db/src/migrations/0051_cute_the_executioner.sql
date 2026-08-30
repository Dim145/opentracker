CREATE TABLE "room_mutes" (
	"user_id" text PRIMARY KEY NOT NULL,
	"until" timestamp NOT NULL,
	"by_id" text,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "room_mutes" ADD CONSTRAINT "room_mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_mutes" ADD CONSTRAINT "room_mutes_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_mutes_until_idx" ON "room_mutes" USING btree ("until");