-- One active proposal per (request, user). The fill endpoint
-- guards this in the transaction with row-locked counting, but
-- a DB-level constraint is the authoritative line of defence
-- against any future codepath (or migration) that forgets to
-- check. Rejected / validated rows stay outside the index so
-- the historical audit trail isn't constrained.
CREATE UNIQUE INDEX "upload_request_fill_attempts_active_unique"
  ON "upload_request_fill_attempts" ("request_id", "user_id")
  WHERE "status" = 'proposed';
