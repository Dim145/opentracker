-- One-way follow edges between users. The follower's identity is
-- private to the follower; the followed user only sees their public
-- count, never the names. Composite PK is the "follow once" guard,
-- so the POST endpoint can ON CONFLICT DO NOTHING without a
-- separate unique index. ON DELETE CASCADE on both FKs keeps the
-- graph clean if either account is purged.
CREATE TABLE "user_follows" (
  "follower_id"  text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "following_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "created_at"   timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("follower_id", "following_id")
);

-- Drives the upload fan-out: "every follower of user X" is the hot
-- path when X uploads a torrent that hits 'accepted' status. Also
-- serves the public follower count via COUNT(*) WHERE following_id.
CREATE INDEX "user_follows_following_idx"
  ON "user_follows" ("following_id");
