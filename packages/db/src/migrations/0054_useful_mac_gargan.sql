CREATE TABLE "message_reactions" (
	"message_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "message_reactions_message_id_user_id_key_pk" PRIMARY KEY("message_id","user_id","key"),
	CONSTRAINT "message_reactions_key_ck" CHECK ("message_reactions"."key" IN ('up', 'heart', 'haha', 'wow', 'thanks', 'done'))
);
--> statement-breakpoint
CREATE TABLE "room_message_reactions" (
	"message_id" text NOT NULL,
	"message_created_at" timestamp NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "room_message_reactions_message_id_message_created_at_user_id_key_pk" PRIMARY KEY("message_id","message_created_at","user_id","key"),
	CONSTRAINT "room_message_reactions_key_ck" CHECK ("room_message_reactions"."key" IN ('up', 'heart', 'haha', 'wow', 'thanks', 'done'))
) PARTITION BY RANGE ("message_created_at");
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "reply_to_id" text;--> statement-breakpoint
ALTER TABLE "room_messages" ADD COLUMN "reply_to_id" text;--> statement-breakpoint
ALTER TABLE "room_messages" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_reactions" ADD CONSTRAINT "message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_message_reactions" ADD CONSTRAINT "room_message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_reactions_message_idx" ON "message_reactions" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "room_message_reactions_message_idx" ON "room_message_reactions" USING btree ("message_id","message_created_at");--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reply_to_id_messages_id_fk" FOREIGN KEY ("reply_to_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Partitioning for `room_message_reactions`, by hand for the same reason
-- as `room_messages` in 0049: drizzle-kit has no notion of declarative
-- partitioning, and repartitioning a populated table costs a maintenance
-- window, so it happens while the table is empty.
--
-- Keyed on the MESSAGE's day, not the reaction's. That is what puts a
-- day's reactions in the partition the retention sweep already drops.
-- Keyed on its own timestamp instead, a reaction added today to a message
-- from ten days ago would outlive the message by ten days — rows pointing
-- at nothing, accumulating behind a feature whose whole purpose is to
-- forget.
--
-- Same DEFAULT safety net as the messages: an insert arriving after the
-- maintenance job has lapsed lands there rather than failing, which for a
-- reaction means a click that silently does nothing.
DO $$
DECLARE
    day date := date_trunc('day', now())::date - 1;
    stop date := date_trunc('day', now())::date + 60;
BEGIN
    WHILE day < stop LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF room_message_reactions FOR VALUES FROM (%L) TO (%L)',
            'room_message_reactions_' || to_char(day, 'YYYYMMDD'),
            day,
            day + 1
        );
        day := day + 1;
    END LOOP;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_message_reactions_default" PARTITION OF "room_message_reactions" DEFAULT;
