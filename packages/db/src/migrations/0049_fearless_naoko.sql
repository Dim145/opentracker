CREATE TABLE "conversation_participants" (
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"last_read_at" timestamp,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"muted_until" timestamp,
	"archived_at" timestamp,
	"state" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "conversation_participants_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id"),
	CONSTRAINT "conversation_participants_state_ck" CHECK ("conversation_participants"."state" IN ('active', 'pending', 'blocked')),
	CONSTRAINT "conversation_participants_unread_ck" CHECK ("conversation_participants"."unread_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"slug" text,
	"title" text,
	"encrypted" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_kind_ck" CHECK ("conversations"."kind" IN ('dm', 'room')),
	CONSTRAINT "conversations_room_slug_ck" CHECK (("conversations"."kind" = 'room') = ("conversations"."slug" IS NOT NULL)),
	CONSTRAINT "conversations_room_plain_ck" CHECK (NOT ("conversations"."kind" = 'room' AND "conversations"."encrypted"))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"author_id" text,
	"body" text,
	"cipher" "bytea",
	"iv" "bytea",
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"edited_at" timestamp,
	"deleted_at" timestamp,
	"deleted_by_id" text,
	CONSTRAINT "messages_payload_ck" CHECK ("messages"."deleted_at" IS NOT NULL OR (("messages"."body" IS NOT NULL) <> ("messages"."cipher" IS NOT NULL))),
	CONSTRAINT "messages_cipher_iv_ck" CHECK (("messages"."cipher" IS NULL) = ("messages"."iv" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "room_messages" (
	"id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"deleted_by_id" text,
	CONSTRAINT "room_messages_id_created_at_pk" PRIMARY KEY("id","created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_messages" ADD CONSTRAINT "room_messages_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_participants_inbox_idx" ON "conversation_participants" USING btree ("user_id","state","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_slug_idx" ON "conversations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "conversations_last_message_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "room_messages_conversation_idx" ON "room_messages" USING btree ("conversation_id","created_at");
--> statement-breakpoint
-- Partitioning for `room_messages`, added by hand: drizzle-kit has no notion
-- of declarative partitioning, and this is the one shape that cannot be
-- retrofitted cheaply — repartitioning a populated table costs a maintenance
-- window, so it is done while the table is empty.
--
-- Retention is a DROP of whole partitions rather than a DELETE over millions
-- of rows: instant, no lock held, nothing left for autovacuum.
--
-- A DEFAULT partition is the safety net. Nothing writes to this table until
-- the room ships, and the maintenance job that rolls the window forward comes
-- with it; until then — and any time that job lapses — an insert lands in the
-- default rather than failing outright. A room that stops accepting messages
-- at 3am because tomorrow's partition was never created is the failure this
-- prevents.
DO $$
DECLARE
    day date := date_trunc('day', now())::date - 1;
    stop date := date_trunc('day', now())::date + 60;
BEGIN
    WHILE day < stop LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF room_messages FOR VALUES FROM (%L) TO (%L)',
            'room_messages_' || to_char(day, 'YYYYMMDD'),
            day,
            day + 1
        );
        day := day + 1;
    END LOOP;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "room_messages_default" PARTITION OF "room_messages" DEFAULT;
