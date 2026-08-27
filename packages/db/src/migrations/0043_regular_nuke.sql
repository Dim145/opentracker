ALTER TABLE "federation_credit_grants" ADD COLUMN "period_start" timestamp;--> statement-breakpoint
ALTER TABLE "federation_credit_grants" ADD COLUMN "period_end" timestamp;--> statement-breakpoint
CREATE INDEX "federation_credit_grants_period_idx" ON "federation_credit_grants" USING btree ("peer_id","subject_did","period_end");--> statement-breakpoint
CREATE INDEX "federation_credit_grants_created_idx" ON "federation_credit_grants" USING btree ("created_at");