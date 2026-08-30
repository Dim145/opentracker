CREATE TABLE "ticket_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"from_staff" boolean DEFAULT false NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"number" serial NOT NULL,
	"opened_by_id" text,
	"opened_by_name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closure_reason" text,
	"idle_notice_at" timestamp with time zone,
	"assigned_to_id" text,
	"assigned_to_name" text,
	"assigned_at" timestamp,
	"closed_by_id" text,
	"closed_by_name" text,
	"closed_at" timestamp,
	"closing_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	"last_message_by" text DEFAULT 'member' NOT NULL,
	CONSTRAINT "tickets_status_ck" CHECK ("tickets"."status" IN ('open', 'closed')),
	CONSTRAINT "tickets_closure_ck" CHECK ("tickets"."closure_reason" IS NULL
          OR "tickets"."closure_reason"
             IN ('resolved', 'rejected', 'stale', 'withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_opened_by_id_users_id_fk" FOREIGN KEY ("opened_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_closed_by_id_users_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_number_idx" ON "tickets" USING btree ("number");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX "tickets_opened_by_idx" ON "tickets" USING btree ("opened_by_id","created_at");