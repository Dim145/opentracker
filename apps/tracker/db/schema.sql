-- Schema subset used by the tracker.
--
-- This is a hand-curated subset of the full Drizzle schema living in
-- packages/db/src/schema.ts. We only declare the tables and columns the
-- tracker reads/writes — sqlc only needs to know about those.
--
-- Drizzle remains the source of truth for migrations. To refresh this file
-- after a schema change, run: ./scripts/dump-schema.sh

CREATE TABLE IF NOT EXISTS users (
    id                text        PRIMARY KEY,
    username          text        NOT NULL UNIQUE,
    auth_salt         text        NOT NULL,
    auth_verifier     text        NOT NULL,
    passkey           text        NOT NULL UNIQUE,
    is_admin          boolean     NOT NULL DEFAULT false,
    is_moderator      boolean     NOT NULL DEFAULT false,
    is_banned         boolean     NOT NULL DEFAULT false,
    role_id           text,
    last_ip           text,
    uploaded          bigint      NOT NULL DEFAULT 0,
    downloaded        bigint      NOT NULL DEFAULT 0,
    invites_remaining integer     NOT NULL DEFAULT 0,
    panic_password_hash text,
    created_at        timestamp   NOT NULL DEFAULT NOW(),
    last_seen         timestamp   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS torrents (
    id            text      PRIMARY KEY,
    info_hash     text      NOT NULL UNIQUE,
    name          text      NOT NULL,
    size          bigint    NOT NULL,
    description   text,
    torrent_data  bytea,
    uploader_id   text,
    category_id   text,
    is_active     boolean   NOT NULL DEFAULT true,
    is_approved   boolean   NOT NULL DEFAULT false,
    created_at    timestamp NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
    key        text       PRIMARY KEY,
    value      text       NOT NULL,
    updated_at timestamp  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hnr_tracking (
    id                  text       PRIMARY KEY,
    user_id             text       NOT NULL,
    torrent_id          text       NOT NULL,
    downloaded_at       timestamp  NOT NULL DEFAULT NOW(),
    seed_time           integer    NOT NULL DEFAULT 0,
    required_seed_time  integer    NOT NULL DEFAULT 86400,
    is_hnr              boolean    NOT NULL DEFAULT false,
    is_exempt           boolean    NOT NULL DEFAULT false,
    completed_at        timestamp,
    -- Per (user, torrent) byte accounting. Mirrors the deltas the
    -- handler already pushes into users.uploaded / users.downloaded so
    -- the "Downloads" page in the web UI can break the totals down by
    -- torrent. Defaults to 0 so old rows render as "no data".
    uploaded            bigint     NOT NULL DEFAULT 0,
    downloaded          bigint     NOT NULL DEFAULT 0,
    UNIQUE (user_id, torrent_id)
);
