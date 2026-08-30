CREATE TABLE "messaging_blocks" (
	"user_id" text NOT NULL,
	"blocked_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_blocks_user_id_blocked_id_pk" PRIMARY KEY("user_id","blocked_id"),
	CONSTRAINT "messaging_blocks_self_ck" CHECK ("messaging_blocks"."user_id" <> "messaging_blocks"."blocked_id")
);
--> statement-breakpoint
ALTER TABLE "messaging_blocks" ADD CONSTRAINT "messaging_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_blocks" ADD CONSTRAINT "messaging_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messaging_blocks_blocked_idx" ON "messaging_blocks" USING btree ("blocked_id");