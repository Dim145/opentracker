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
    -- SHA-256 of the v2 info dict, hex, for a v2 or hybrid torrent; NULL for
    -- a v1-only one. A client announcing into the v2 swarm sends the first 20
    -- bytes of this, so the announce path looks up `left(info_hash_v2, 40)`.
    -- Written by the api at upload time; the tracker only reads it.
    info_hash_v2  text,
    name          text      NOT NULL,
    size          bigint    NOT NULL,
    description   text,
    torrent_data  bytea,
    uploader_id   text,
    category_id   text,
    is_active     boolean   NOT NULL DEFAULT true,
    -- Per-torrent bonus multipliers, basis points x100 (0 = freeleech,
    -- 100 = normal, 200 = double). NULL `multipliers_until` means the buff has
    -- no end date; a past one means it has lapsed, and the announce query
    -- neutralises it in SQL so the hot path carries no clock logic.
    download_multiplier integer NOT NULL DEFAULT 100,
    upload_multiplier   integer NOT NULL DEFAULT 100,
    multipliers_until   timestamp,
    -- L'état de modération. Remplace le booléen `is_approved`, que la migration
    -- 0026a a supprimé de la vraie base — ce fichier le portait encore, si bien
    -- que le schéma contre lequel sqlc valide les requêtes du tracker avait
    -- dérivé de la base réelle. Une requête référençant une colonne inexistante
    -- passait donc la génération et n'échouait qu'à l'exécution.
    moderation_status text NOT NULL DEFAULT 'pending',
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
