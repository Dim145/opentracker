CREATE TABLE "user_message_keys" (
	"user_id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"alg" text DEFAULT 'ECDH-P256' NOT NULL,
	"device_label" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_message_keys" ADD CONSTRAINT "user_message_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;