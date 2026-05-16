-- Per-user torrent favorites. Strictly private: no uploader
-- notification, no public counter, no profile-page exposure. The
-- composite PK (user_id, torrent_id) is also the uniqueness
-- guard, so the POST endpoint can ON CONFLICT DO NOTHING without
-- a separate index. ON DELETE CASCADE on both FKs keeps the row
-- set clean when a user or torrent is dropped.
CREATE TABLE "torrent_favorites" (
  "user_id"    text NOT NULL REFERENCES "users"("id")    ON DELETE CASCADE,
  "torrent_id" text NOT NULL REFERENCES "torrents"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("user_id", "torrent_id")
);

-- Listing index for /me/favorites (newest first). The composite
-- PK already covers "is X favorited by Y" lookups.
CREATE INDEX "torrent_favorites_user_created_idx"
  ON "torrent_favorites" ("user_id", "created_at");
