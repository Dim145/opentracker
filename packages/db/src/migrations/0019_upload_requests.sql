-- Upload requests — a user-driven bounty board.
--
-- The flow is split across three tables:
--   * upload_requests              — the bounty itself
--   * upload_request_fill_attempts — counter of who proposed what, so
--                                    we can cap per-user re-proposals
--   * upload_request_comments      — discussion thread (15-min author
--                                    edit window, staff soft-delete)
--
-- The reward is deducted from the requester's bonus_points at creation
-- and held by the system until either:
--   * the request is cancelled  → refunded
--   * the requester validates   → transferred to the filler
--   * the request auto-validates → transferred to the filler

CREATE TABLE "upload_requests" (
  "id"                 text PRIMARY KEY,
  "requester_id"       text NOT NULL REFERENCES "users"("id")      ON DELETE CASCADE,
  "category_id"        text NOT NULL REFERENCES "categories"("id") ON DELETE RESTRICT,
  "title"              text NOT NULL,
  "description"        text NOT NULL,
  "reward_points"      integer NOT NULL DEFAULT 0,
  "status"             text NOT NULL DEFAULT 'requested',
  "filled_by_id"       text REFERENCES "users"("id")    ON DELETE SET NULL,
  "filled_torrent_id"  text REFERENCES "torrents"("id") ON DELETE SET NULL,
  "filled_at"          timestamp,
  "validated_at"       timestamp,
  "cancelled_at"       timestamp,
  "created_at"         timestamp NOT NULL DEFAULT NOW(),
  "updated_at"         timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX "upload_requests_status_idx"
  ON "upload_requests" ("status", "created_at");
CREATE INDEX "upload_requests_requester_idx"
  ON "upload_requests" ("requester_id", "created_at");
-- Partial: only the rows the auto-validate cron actually scans. Keeps
-- the index small even with thousands of long-closed requests sitting
-- in the table.
CREATE INDEX "upload_requests_filled_at_idx"
  ON "upload_requests" ("filled_at")
  WHERE "status" = 'filled' AND "filled_at" IS NOT NULL;

CREATE TABLE "upload_request_fill_attempts" (
  "id"           text PRIMARY KEY,
  "request_id"   text NOT NULL REFERENCES "upload_requests"("id") ON DELETE CASCADE,
  "user_id"      text NOT NULL REFERENCES "users"("id")           ON DELETE CASCADE,
  "torrent_id"   text NOT NULL REFERENCES "torrents"("id")        ON DELETE CASCADE,
  "status"       text NOT NULL DEFAULT 'proposed',
  "created_at"   timestamp NOT NULL DEFAULT NOW(),
  "rejected_at"  timestamp
);
CREATE INDEX "upload_request_fill_attempts_request_user_idx"
  ON "upload_request_fill_attempts" ("request_id", "user_id");

CREATE TABLE "upload_request_comments" (
  "id"             text PRIMARY KEY,
  "request_id"     text NOT NULL REFERENCES "upload_requests"("id") ON DELETE CASCADE,
  "author_id"      text REFERENCES "users"("id") ON DELETE SET NULL,
  "body"           text NOT NULL,
  "created_at"     timestamp NOT NULL DEFAULT NOW(),
  "edited_at"      timestamp,
  "deleted_at"     timestamp,
  "deleted_by_id"  text REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE INDEX "upload_request_comments_request_idx"
  ON "upload_request_comments" ("request_id", "created_at");
