ALTER TABLE "users" ADD COLUMN "is_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: the oldest ELIGIBLE admin becomes the owner.
--
-- Hand-added to the generated migration, because a column nobody holds is a
-- capability nobody has: every route gated on `is_owner` would answer 403 to
-- everyone on an existing install, including the person who set it up.
--
-- Eligible means an admin who can actually act — not erased, not banned. The
-- tie-break on `id` is there so two accounts created in the same millisecond
-- resolve the same way on every replica that runs this.
--
-- Zero rows updated is the correct outcome on an empty database: the first
-- registration sets it, the same way it already sets `is_admin`.
UPDATE "users" SET "is_owner" = true
 WHERE "id" = (
   SELECT "id" FROM "users"
    WHERE "is_admin" AND NOT "is_banned" AND "deleted_at" IS NULL
    ORDER BY "created_at" ASC, "id" ASC
    LIMIT 1
 );--> statement-breakpoint
CREATE UNIQUE INDEX "users_owner_unique" ON "users" USING btree ("is_owner") WHERE "users"."is_owner";