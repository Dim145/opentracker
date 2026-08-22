-- Catch-up: the 24 tables that `drizzle-kit push` created directly and no
-- migration ever captured.
--
-- Until now the migration chain covered 30 of the 54 tables in schema.ts. The
-- rest — the whole bonus system, federation, notifications, 2FA, the shop,
-- roles and upload rules — only ever existed because `push` diffed schema.ts
-- against a live database at boot. That works until you need a reproducible
-- database: a fresh `drizzle-kit migrate` stopped at 30 tables, so migrate was
-- not a usable replacement for push.
--
-- The DDL below is pg_dump output from a database that push had brought to the
-- current schema.ts, rewritten to be safe to re-run: tables and indexes carry
-- IF NOT EXISTS, and every constraint is wrapped so a duplicate is a no-op.
-- That matters because most existing databases already hold most of these
-- objects; this migration has to converge them, not fail on the first one it
-- finds.
--
-- Order is pg_dump's: tables, then indexes, then keys — foreign keys last so
-- their targets exist.

-- ── Tables ────────────────────────────────────────────────────────
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.bonus_age_tiers (
    id text NOT NULL,
    min_age_days integer NOT NULL,
    multiplier integer NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.bonus_events (
    id text NOT NULL,
    title text NOT NULL,
    description text,
    long_description text,
    download_multiplier integer NOT NULL,
    upload_multiplier integer NOT NULL,
    starts_at timestamp without time zone NOT NULL,
    ends_at timestamp without time zone NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by_id text,
    updated_at timestamp without time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.bonus_grants (
    id text NOT NULL,
    user_id text NOT NULL,
    source text NOT NULL,
    torrent_id text,
    amount integer NOT NULL,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.bonus_rules (
    id text NOT NULL,
    kind text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.bonus_seed_count_tiers (
    id text NOT NULL,
    max_seeders integer NOT NULL,
    multiplier integer NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.federated_follows (
    id text NOT NULL,
    local_user_id text NOT NULL,
    peer_id text NOT NULL,
    remote_username text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.federated_identities (
    id text NOT NULL,
    local_user_id text NOT NULL,
    peer_id text NOT NULL,
    remote_username text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    verify_code text,
    verified_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.federation_config (
    id text DEFAULT 'singleton'::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    instance_name text,
    public_url text,
    instance_id text,
    public_key text,
    private_key_enc text,
    default_scopes jsonb DEFAULT '{"swarm": false, "social": false, "catalog": false, "accounts": false}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.federation_peers (
    id text NOT NULL,
    base_url text NOT NULL,
    instance_id text,
    public_key text,
    display_name text,
    status text DEFAULT 'pending_out'::text NOT NULL,
    shares_with_them jsonb DEFAULT '{"swarm": false, "social": false, "catalog": false, "accounts": false}'::jsonb NOT NULL,
    accepts_from_them jsonb DEFAULT '{"swarm": false, "social": false, "catalog": false, "accounts": false}'::jsonb NOT NULL,
    last_handshake_at timestamp without time zone,
    last_seen_at timestamp without time zone,
    last_error text,
    created_by text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.federation_sync_state (
    peer_id text NOT NULL,
    resource text NOT NULL,
    cursor text,
    last_run_at timestamp without time zone,
    last_status text,
    items_synced integer DEFAULT 0 NOT NULL,
    last_error text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.notification_channels (
    type text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    server_config text DEFAULT ''::text NOT NULL,
    last_test_status text,
    last_test_error text,
    last_tested_at timestamp without time zone,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_by text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.notifications (
    id text NOT NULL,
    user_id text NOT NULL,
    type text NOT NULL,
    payload jsonb,
    link text,
    read_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.recovery_codes (
    id text NOT NULL,
    user_id text NOT NULL,
    code_hash text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    used_at timestamp without time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.remote_torrents (
    id text NOT NULL,
    peer_id text NOT NULL,
    remote_id text NOT NULL,
    info_hash text NOT NULL,
    content_signature text,
    name text NOT NULL,
    size bigint NOT NULL,
    description text,
    category_slug text,
    category_type text,
    is_adult boolean DEFAULT false NOT NULL,
    tags jsonb,
    imdb_id text,
    tmdb_id text,
    tvdb_id text,
    igdb_id text,
    openlibrary_id text,
    seeders integer DEFAULT 0 NOT NULL,
    leechers integer DEFAULT 0 NOT NULL,
    completed integer DEFAULT 0 NOT NULL,
    uploader_name text,
    remote_created_at timestamp without time zone,
    remote_detail_url text,
    remote_download_url text,
    fetched_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    season smallint,
    episode smallint,
    record_id text,
    issuer text,
    verified boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.shop_items (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    icon text,
    type text NOT NULL,
    payload jsonb NOT NULL,
    cost integer NOT NULL,
    stock integer,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.shop_purchases (
    id text NOT NULL,
    user_id text NOT NULL,
    item_id text NOT NULL,
    item_name_snapshot text NOT NULL,
    item_type_snapshot text NOT NULL,
    cost_paid integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.torrent_moderation_messages (
    id text NOT NULL,
    torrent_id text NOT NULL,
    author_id text,
    body text NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    status_change text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.trusted_devices (
    id text NOT NULL,
    user_id text NOT NULL,
    token_hash text NOT NULL,
    label text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    last_used_at timestamp without time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.upload_rule_category_patterns (
    category_id text NOT NULL,
    pattern text NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.upload_rules (
    id text DEFAULT 'singleton'::text NOT NULL,
    nfo_required boolean DEFAULT false NOT NULL,
    description_required boolean DEFAULT false NOT NULL,
    description_min_length integer DEFAULT 0 NOT NULL,
    title_pattern_enforced boolean DEFAULT false NOT NULL,
    title_blocklist text,
    tmdb_id_required boolean DEFAULT false NOT NULL,
    max_torrent_size bigint,
    staff_bypass boolean DEFAULT true NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.user_notification_channels (
    id text NOT NULL,
    user_id text NOT NULL,
    channel_type text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    user_config text DEFAULT ''::text NOT NULL,
    last_test_status text,
    last_test_error text,
    last_tested_at timestamp without time zone,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.user_notification_routing (
    user_id text NOT NULL,
    type text NOT NULL,
    channel_type text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id text NOT NULL,
    role_id text NOT NULL,
    assigned_at timestamp without time zone DEFAULT now() NOT NULL,
    assigned_manually boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.webauthn_credentials (
    id text NOT NULL,
    user_id text NOT NULL,
    credential_id text NOT NULL,
    public_key text NOT NULL,
    counter bigint DEFAULT 0 NOT NULL,
    transports text,
    name text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    last_used_at timestamp without time zone
);
-- ── Indexes ───────────────────────────────────────────────────────
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bonus_age_tiers_enabled_idx ON public.bonus_age_tiers USING btree (enabled);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bonus_age_tiers_threshold_idx ON public.bonus_age_tiers USING btree (min_age_days);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bonus_events_enabled_idx ON public.bonus_events USING btree (enabled);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bonus_events_window_idx ON public.bonus_events USING btree (starts_at, ends_at);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS bonus_grants_first_seeder_unique_idx ON public.bonus_grants USING btree (torrent_id) WHERE ((source = 'first_seeder'::text) AND (torrent_id IS NOT NULL));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bonus_grants_source_user_torrent_idx ON public.bonus_grants USING btree (source, user_id, torrent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bonus_grants_user_idx ON public.bonus_grants USING btree (user_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bonus_rules_kind_idx ON public.bonus_rules USING btree (kind);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bonus_seed_count_tiers_enabled_idx ON public.bonus_seed_count_tiers USING btree (enabled);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bonus_seed_count_tiers_threshold_idx ON public.bonus_seed_count_tiers USING btree (max_seeders);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS federated_follows_target_idx ON public.federated_follows USING btree (peer_id, remote_username);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS federated_follows_unique ON public.federated_follows USING btree (local_user_id, peer_id, remote_username);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS federated_identities_unique ON public.federated_identities USING btree (local_user_id, peer_id, remote_username);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS federation_peers_instance_id_unique ON public.federation_peers USING btree (instance_id) WHERE (instance_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS federation_peers_status_idx ON public.federation_peers USING btree (status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON public.notifications USING btree (user_id, created_at DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx ON public.notifications USING btree (user_id) WHERE (read_at IS NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS recovery_codes_user_idx ON public.recovery_codes USING btree (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS remote_torrents_content_sig_idx ON public.remote_torrents USING btree (content_signature);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS remote_torrents_igdb_idx ON public.remote_torrents USING btree (igdb_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS remote_torrents_imdb_idx ON public.remote_torrents USING btree (imdb_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS remote_torrents_info_hash_idx ON public.remote_torrents USING btree (info_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS remote_torrents_name_idx ON public.remote_torrents USING btree (name);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS remote_torrents_openlibrary_idx ON public.remote_torrents USING btree (openlibrary_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS remote_torrents_peer_remote_unique ON public.remote_torrents USING btree (peer_id, remote_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS remote_torrents_record_idx ON public.remote_torrents USING btree (record_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS remote_torrents_tmdb_idx ON public.remote_torrents USING btree (tmdb_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shop_items_enabled_idx ON public.shop_items USING btree (enabled);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shop_purchases_item_idx ON public.shop_purchases USING btree (item_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS shop_purchases_user_idx ON public.shop_purchases USING btree (user_id, created_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS torrent_mod_messages_author_idx ON public.torrent_moderation_messages USING btree (author_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS torrent_mod_messages_torrent_idx ON public.torrent_moderation_messages USING btree (torrent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trusted_devices_expires_idx ON public.trusted_devices USING btree (expires_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trusted_devices_user_idx ON public.trusted_devices USING btree (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS user_notification_channels_user_type_unique ON public.user_notification_channels USING btree (user_id, channel_type);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS user_notification_routing_pk ON public.user_notification_routing USING btree (user_id, type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_notification_routing_user_idx ON public.user_notification_routing USING btree (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS user_roles_role_idx ON public.user_roles USING btree (role_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx ON public.webauthn_credentials USING btree (user_id);
-- ── Primary and foreign keys ──────────────────────────────────────
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.bonus_age_tiers'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.bonus_age_tiers
          ADD CONSTRAINT bonus_age_tiers_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.bonus_events'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.bonus_events
          ADD CONSTRAINT bonus_events_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.bonus_grants'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.bonus_grants
          ADD CONSTRAINT bonus_grants_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'bonus_rules_kind_unique' AND conrelid = 'public.bonus_rules'::regclass) THEN
    ALTER TABLE ONLY public.bonus_rules
          ADD CONSTRAINT bonus_rules_kind_unique UNIQUE (kind);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.bonus_rules'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.bonus_rules
          ADD CONSTRAINT bonus_rules_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.bonus_seed_count_tiers'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.bonus_seed_count_tiers
          ADD CONSTRAINT bonus_seed_count_tiers_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.federated_follows'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.federated_follows
          ADD CONSTRAINT federated_follows_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.federated_identities'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.federated_identities
          ADD CONSTRAINT federated_identities_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.federation_config'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.federation_config
          ADD CONSTRAINT federation_config_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'federation_peers_base_url_unique' AND conrelid = 'public.federation_peers'::regclass) THEN
    ALTER TABLE ONLY public.federation_peers
          ADD CONSTRAINT federation_peers_base_url_unique UNIQUE (base_url);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.federation_peers'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.federation_peers
          ADD CONSTRAINT federation_peers_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.federation_sync_state'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.federation_sync_state
          ADD CONSTRAINT federation_sync_state_peer_id_resource_pk PRIMARY KEY (peer_id, resource);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.notification_channels'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.notification_channels
          ADD CONSTRAINT notification_channels_pkey PRIMARY KEY (type);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.notifications'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.notifications
          ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.recovery_codes'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.recovery_codes
          ADD CONSTRAINT recovery_codes_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.remote_torrents'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.remote_torrents
          ADD CONSTRAINT remote_torrents_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.shop_items'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.shop_items
          ADD CONSTRAINT shop_items_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.shop_purchases'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.shop_purchases
          ADD CONSTRAINT shop_purchases_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.torrent_moderation_messages'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.torrent_moderation_messages
          ADD CONSTRAINT torrent_moderation_messages_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.trusted_devices'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.trusted_devices
          ADD CONSTRAINT trusted_devices_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'trusted_devices_token_hash_unique' AND conrelid = 'public.trusted_devices'::regclass) THEN
    ALTER TABLE ONLY public.trusted_devices
          ADD CONSTRAINT trusted_devices_token_hash_unique UNIQUE (token_hash);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.upload_rule_category_patterns'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.upload_rule_category_patterns
          ADD CONSTRAINT upload_rule_category_patterns_pkey PRIMARY KEY (category_id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.upload_rules'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.upload_rules
          ADD CONSTRAINT upload_rules_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.user_notification_channels'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.user_notification_channels
          ADD CONSTRAINT user_notification_channels_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.user_roles'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.user_roles
          ADD CONSTRAINT user_roles_user_id_role_id_pk PRIMARY KEY (user_id, role_id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'webauthn_credentials_credential_id_unique' AND conrelid = 'public.webauthn_credentials'::regclass) THEN
    ALTER TABLE ONLY public.webauthn_credentials
          ADD CONSTRAINT webauthn_credentials_credential_id_unique UNIQUE (credential_id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conrelid = 'public.webauthn_credentials'::regclass AND contype = 'p') THEN
    ALTER TABLE ONLY public.webauthn_credentials
          ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'bonus_events_created_by_id_users_id_fk' AND conrelid = 'public.bonus_events'::regclass) THEN
    ALTER TABLE ONLY public.bonus_events
          ADD CONSTRAINT bonus_events_created_by_id_users_id_fk FOREIGN KEY (created_by_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'bonus_grants_torrent_id_torrents_id_fk' AND conrelid = 'public.bonus_grants'::regclass) THEN
    ALTER TABLE ONLY public.bonus_grants
          ADD CONSTRAINT bonus_grants_torrent_id_torrents_id_fk FOREIGN KEY (torrent_id) REFERENCES public.torrents(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'bonus_grants_user_id_users_id_fk' AND conrelid = 'public.bonus_grants'::regclass) THEN
    ALTER TABLE ONLY public.bonus_grants
          ADD CONSTRAINT bonus_grants_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'federated_follows_local_user_id_users_id_fk' AND conrelid = 'public.federated_follows'::regclass) THEN
    ALTER TABLE ONLY public.federated_follows
          ADD CONSTRAINT federated_follows_local_user_id_users_id_fk FOREIGN KEY (local_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'federated_follows_peer_id_federation_peers_id_fk' AND conrelid = 'public.federated_follows'::regclass) THEN
    ALTER TABLE ONLY public.federated_follows
          ADD CONSTRAINT federated_follows_peer_id_federation_peers_id_fk FOREIGN KEY (peer_id) REFERENCES public.federation_peers(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'federated_identities_local_user_id_users_id_fk' AND conrelid = 'public.federated_identities'::regclass) THEN
    ALTER TABLE ONLY public.federated_identities
          ADD CONSTRAINT federated_identities_local_user_id_users_id_fk FOREIGN KEY (local_user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'federated_identities_peer_id_federation_peers_id_fk' AND conrelid = 'public.federated_identities'::regclass) THEN
    ALTER TABLE ONLY public.federated_identities
          ADD CONSTRAINT federated_identities_peer_id_federation_peers_id_fk FOREIGN KEY (peer_id) REFERENCES public.federation_peers(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'federation_peers_created_by_users_id_fk' AND conrelid = 'public.federation_peers'::regclass) THEN
    ALTER TABLE ONLY public.federation_peers
          ADD CONSTRAINT federation_peers_created_by_users_id_fk FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'federation_sync_state_peer_id_federation_peers_id_fk' AND conrelid = 'public.federation_sync_state'::regclass) THEN
    ALTER TABLE ONLY public.federation_sync_state
          ADD CONSTRAINT federation_sync_state_peer_id_federation_peers_id_fk FOREIGN KEY (peer_id) REFERENCES public.federation_peers(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'notification_channels_updated_by_users_id_fk' AND conrelid = 'public.notification_channels'::regclass) THEN
    ALTER TABLE ONLY public.notification_channels
          ADD CONSTRAINT notification_channels_updated_by_users_id_fk FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'notifications_user_id_users_id_fk' AND conrelid = 'public.notifications'::regclass) THEN
    ALTER TABLE ONLY public.notifications
          ADD CONSTRAINT notifications_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'recovery_codes_user_id_users_id_fk' AND conrelid = 'public.recovery_codes'::regclass) THEN
    ALTER TABLE ONLY public.recovery_codes
          ADD CONSTRAINT recovery_codes_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'remote_torrents_peer_id_federation_peers_id_fk' AND conrelid = 'public.remote_torrents'::regclass) THEN
    ALTER TABLE ONLY public.remote_torrents
          ADD CONSTRAINT remote_torrents_peer_id_federation_peers_id_fk FOREIGN KEY (peer_id) REFERENCES public.federation_peers(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'shop_purchases_item_id_shop_items_id_fk' AND conrelid = 'public.shop_purchases'::regclass) THEN
    ALTER TABLE ONLY public.shop_purchases
          ADD CONSTRAINT shop_purchases_item_id_shop_items_id_fk FOREIGN KEY (item_id) REFERENCES public.shop_items(id) ON DELETE RESTRICT;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'shop_purchases_user_id_users_id_fk' AND conrelid = 'public.shop_purchases'::regclass) THEN
    ALTER TABLE ONLY public.shop_purchases
          ADD CONSTRAINT shop_purchases_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'torrent_moderation_messages_author_id_users_id_fk' AND conrelid = 'public.torrent_moderation_messages'::regclass) THEN
    ALTER TABLE ONLY public.torrent_moderation_messages
          ADD CONSTRAINT torrent_moderation_messages_author_id_users_id_fk FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'torrent_moderation_messages_torrent_id_torrents_id_fk' AND conrelid = 'public.torrent_moderation_messages'::regclass) THEN
    ALTER TABLE ONLY public.torrent_moderation_messages
          ADD CONSTRAINT torrent_moderation_messages_torrent_id_torrents_id_fk FOREIGN KEY (torrent_id) REFERENCES public.torrents(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'trusted_devices_user_id_users_id_fk' AND conrelid = 'public.trusted_devices'::regclass) THEN
    ALTER TABLE ONLY public.trusted_devices
          ADD CONSTRAINT trusted_devices_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'upload_rule_category_patterns_category_id_categories_id_fk' AND conrelid = 'public.upload_rule_category_patterns'::regclass) THEN
    ALTER TABLE ONLY public.upload_rule_category_patterns
          ADD CONSTRAINT upload_rule_category_patterns_category_id_categories_id_fk FOREIGN KEY (category_id) REFERENCES public.categories(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'user_notification_channels_user_id_users_id_fk' AND conrelid = 'public.user_notification_channels'::regclass) THEN
    ALTER TABLE ONLY public.user_notification_channels
          ADD CONSTRAINT user_notification_channels_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'user_notification_routing_user_id_users_id_fk' AND conrelid = 'public.user_notification_routing'::regclass) THEN
    ALTER TABLE ONLY public.user_notification_routing
          ADD CONSTRAINT user_notification_routing_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'user_roles_role_id_roles_id_fk' AND conrelid = 'public.user_roles'::regclass) THEN
    ALTER TABLE ONLY public.user_roles
          ADD CONSTRAINT user_roles_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'user_roles_user_id_users_id_fk' AND conrelid = 'public.user_roles'::regclass) THEN
    ALTER TABLE ONLY public.user_roles
          ADD CONSTRAINT user_roles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'webauthn_credentials_user_id_users_id_fk' AND conrelid = 'public.webauthn_credentials'::regclass) THEN
    ALTER TABLE ONLY public.webauthn_credentials
          ADD CONSTRAINT webauthn_credentials_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;
