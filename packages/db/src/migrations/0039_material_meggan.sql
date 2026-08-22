-- Inter-instance credit ledger (credit model / M4 prerequisite): the record of
-- partner contribution attestations we honoured, one row per attestation (its
-- content-address id is the pk, so a credit is idempotent). IF NOT EXISTS /
-- guarded so a database already carrying it converges.
CREATE TABLE IF NOT EXISTS "federation_credit_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"peer_id" text,
	"subject_did" text NOT NULL,
	"local_user_id" text,
	"bytes" bigint NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'federation_credit_grants_peer_id_federation_peers_id_fk') THEN
    ALTER TABLE "federation_credit_grants" ADD CONSTRAINT "federation_credit_grants_peer_id_federation_peers_id_fk" FOREIGN KEY ("peer_id") REFERENCES "public"."federation_peers"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'federation_credit_grants_local_user_id_users_id_fk') THEN
    ALTER TABLE "federation_credit_grants" ADD CONSTRAINT "federation_credit_grants_local_user_id_users_id_fk" FOREIGN KEY ("local_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "federation_credit_grants_user_idx" ON "federation_credit_grants" USING btree ("local_user_id","created_at");
