-- Anti-cheat audit log. Every time the Go tracker spots an anomaly
-- (impossible upload velocity, paid bytes to an empty swarm, unknown
-- peer_id signature, `completed` without `started`, …) it drops a row
-- here. Manual triage from /mod/anti-cheat — nothing is ever auto-
-- banned; the table is the queue + paper-trail.
CREATE TABLE "anticheat_flags" (
  "id"               text PRIMARY KEY,
  "user_id"          text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "torrent_id"       text REFERENCES "torrents"("id") ON DELETE SET NULL,
  "info_hash"        text NOT NULL,
  "kind"             text NOT NULL,                    -- velocity / no_leecher / unknown_client / event_skip
  "severity"         text NOT NULL DEFAULT 'medium',   -- low | medium | high
  "details"          jsonb NOT NULL DEFAULT '{}',
  "peer_id"          text,
  "ip"               text,
  "user_agent"       text,
  "created_at"       timestamp NOT NULL DEFAULT NOW(),
  "reviewed_at"      timestamp,
  "reviewed_by_id"   text REFERENCES "users"("id") ON DELETE SET NULL,
  "review_verdict"   text,
  "review_note"      text
);

CREATE INDEX "anticheat_flags_user_idx" ON "anticheat_flags" ("user_id", "created_at");
CREATE INDEX "anticheat_flags_unreviewed_idx" ON "anticheat_flags" ("reviewed_at");
CREATE INDEX "anticheat_flags_kind_idx" ON "anticheat_flags" ("kind");
