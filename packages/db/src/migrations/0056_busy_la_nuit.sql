CREATE TABLE "message_read_log" (
	"id" text PRIMARY KEY NOT NULL,
	"reader_id" text,
	"reader_name" text NOT NULL,
	"message_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"report_id" text,
	"disclosed" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "message_read_log" ADD CONSTRAINT "message_read_log_reader_id_users_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_read_log_created_idx" ON "message_read_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "message_read_log_reader_idx" ON "message_read_log" USING btree ("reader_id","created_at");--> statement-breakpoint
CREATE INDEX "message_read_log_message_idx" ON "message_read_log" USING btree ("message_id");