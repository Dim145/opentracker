BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables de transit, aux colonnes de l'ANCIEN schéma.
--
-- Le dump date d'une version antérieure. Pour `torrents`, les 24 colonnes de
-- l'époque sont un sous-ensemble strict des 33 d'aujourd'hui, et les neuf
-- ajoutées sont toutes nullables ou pourvues d'un défaut — donc un INSERT à
-- liste de colonnes explicite passe tel quel. Pour les huit tables liées, les
-- colonnes sont identiques au nom près de l'ordre. Vérifié colonne par colonne
-- contre `information_schema` de la base qui tourne, pas supposé.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE s_categories (id text, name text, slug text, parent_id text,
  created_at timestamp, newznab_id integer, is_adult boolean, type text, icon text);
CREATE TEMP TABLE s_tags (id text, name text, slug text, color text, created_at timestamp);
CREATE TEMP TABLE s_torrents (id text, info_hash text, name text, size bigint,
  description text, torrent_data bytea, uploader_id text, category_id text,
  is_active boolean, created_at timestamp, nfo text, imdb_id text, tmdb_id text,
  tvdb_id text, moderation_status text, moderated_by_id text, moderated_at timestamp,
  igdb_id text, openlibrary_id text, content_signature text, updated_at timestamp,
  episode smallint, federate_swarm boolean, season smallint);
CREATE TEMP TABLE s_torrent_tags (torrent_id text, tag_id text, created_at timestamp);
CREATE TEMP TABLE s_comments (id text, torrent_id text, author_id text, content text,
  created_at timestamp, updated_at timestamp);
CREATE TEMP TABLE s_stats (info_hash text, seeders integer, leechers integer,
  completed integer, updated_at timestamp);
CREATE TEMP TABLE s_favorites (user_id text, torrent_id text, created_at timestamp);
CREATE TEMP TABLE s_modmsgs (id text, torrent_id text, author_id text, body text,
  is_system boolean, status_change text, created_at timestamp);
CREATE TEMP TABLE s_hnr (id text, user_id text, torrent_id text, downloaded_at timestamp,
  seed_time integer, required_seed_time integer, is_hnr boolean, is_exempt boolean,
  completed_at timestamp, uploaded bigint, downloaded bigint);

COPY s_categories FROM '/tmp/imp/categories.tsv';
COPY s_tags FROM '/tmp/imp/tags.tsv';
COPY s_torrents FROM '/tmp/imp/torrents.tsv';
COPY s_torrent_tags FROM '/tmp/imp/torrent_tags.tsv';
COPY s_comments FROM '/tmp/imp/torrent_comments.tsv';
COPY s_stats FROM '/tmp/imp/torrent_stats.tsv';
COPY s_favorites FROM '/tmp/imp/torrent_favorites.tsv';
COPY s_modmsgs FROM '/tmp/imp/torrent_moderation_messages.tsv';
COPY s_hnr FROM '/tmp/imp/hnr_tracking.tsv';

-- ─────────────────────────────────────────────────────────────────────────────
-- À qui rattacher tout ça.
--
-- Le dump ne porte qu'UN compte, et sa ligne `users` contient `auth_verifier`,
-- `passkey`, `totp_secret` et `panic_password_hash` — des secrets de
-- l'instance d'origine. Elle n'est pas importée. Les identifiants d'auteur et
-- de propriétaire sont remappés sur les comptes que le harnais a créés, dont
-- les mots de passe sont publics et faux.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE who AS
SELECT id, username, row_number() OVER (ORDER BY created_at) - 1 AS n
  FROM users;

CREATE TEMP TABLE founder AS SELECT id FROM users WHERE username = 'founder' LIMIT 1;

-- ── Catégories ──────────────────────────────────────────────────────────────
-- `categories_slug_unique` en plus de la clé primaire : deux contraintes
-- uniques, donc un ON CONFLICT ne suffit pas. Filtre explicite.
INSERT INTO categories (id, name, slug, parent_id, created_at, newznab_id, is_adult, type, icon)
SELECT s.id, s.name, s.slug, s.parent_id, s.created_at, s.newznab_id, s.is_adult, s.type, s.icon
  FROM s_categories s
 WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.id = s.id OR c.slug = s.slug);

-- ── Étiquettes ──────────────────────────────────────────────────────────────
-- `tags` porte TROIS index uniques (id, name, slug). Cinq étiquettes du dump
-- existent déjà sous le même nom (1080p, BluRay, FLAC, 2160p, HEVC) : elles ne
-- sont pas dupliquées, leur ancien identifiant est REMAPPÉ sur celui en place,
-- sinon les 68 liaisons `torrent_tags` viseraient des lignes absentes.
CREATE TEMP TABLE tag_map AS
SELECT s.id AS old_id, COALESCE(m.id, s.id) AS new_id, (m.id IS NULL) AS fresh
  FROM s_tags s
  LEFT JOIN LATERAL (
    SELECT t.id FROM tags t
     WHERE lower(t.slug) = lower(s.slug) OR lower(t.name) = lower(s.name)
     LIMIT 1
  ) m ON true;

INSERT INTO tags (id, name, slug, color, created_at)
SELECT s.id, s.name, s.slug, s.color, s.created_at
  FROM s_tags s JOIN tag_map m ON m.old_id = s.id AND m.fresh;

-- ── Torrents ────────────────────────────────────────────────────────────────
INSERT INTO torrents (
  id, info_hash, name, size, description, torrent_data, uploader_id, category_id,
  is_active, created_at, nfo, imdb_id, tmdb_id, tvdb_id, moderation_status,
  moderated_by_id, moderated_at, igdb_id, openlibrary_id, content_signature,
  updated_at, episode, federate_swarm, season)
SELECT s.id, s.info_hash, s.name, s.size, s.description, s.torrent_data,
       (SELECT id FROM founder), s.category_id,
       s.is_active, s.created_at, s.nfo, s.imdb_id, s.tmdb_id, s.tvdb_id,
       s.moderation_status,
       CASE WHEN s.moderated_by_id IS NULL THEN NULL ELSE (SELECT id FROM founder) END,
       s.moderated_at, s.igdb_id, s.openlibrary_id, s.content_signature,
       s.updated_at, s.episode, s.federate_swarm, s.season
  FROM s_torrents s
 WHERE NOT EXISTS (SELECT 1 FROM torrents t WHERE t.id = s.id OR t.info_hash = s.info_hash);

-- ── Liaisons, commentaires, essaim ──────────────────────────────────────────
INSERT INTO torrent_tags (torrent_id, tag_id, created_at)
SELECT s.torrent_id, m.new_id, s.created_at
  FROM s_torrent_tags s
  JOIN tag_map m ON m.old_id = s.tag_id
 WHERE EXISTS (SELECT 1 FROM torrents t WHERE t.id = s.torrent_id)
   AND EXISTS (SELECT 1 FROM tags g WHERE g.id = m.new_id)
ON CONFLICT (torrent_id, tag_id) DO NOTHING;

-- Les auteurs sont RÉPARTIS sur les comptes du harnais. Le dump n'en a qu'un,
-- et un fil où tout le monde est la même personne ne dit rien de la mise en
-- page d'un fil — c'est de la donnée de démonstration, pas une attribution.
WITH numbered AS (
  SELECT s.*, (row_number() OVER (ORDER BY s.created_at) - 1) AS rn
    FROM s_comments s
   WHERE EXISTS (SELECT 1 FROM torrents t WHERE t.id = s.torrent_id)
)
INSERT INTO torrent_comments (id, torrent_id, author_id, content, created_at, updated_at)
SELECT n.id, n.torrent_id, w.id, n.content, n.created_at, n.updated_at
  FROM numbered n
  JOIN who w ON w.n = n.rn % (SELECT count(*) FROM who)
ON CONFLICT (id) DO NOTHING;

INSERT INTO torrent_stats (info_hash, seeders, leechers, completed, updated_at)
SELECT s.info_hash, s.seeders, s.leechers, s.completed, s.updated_at
  FROM s_stats s
 WHERE EXISTS (SELECT 1 FROM torrents t WHERE t.info_hash = s.info_hash)
ON CONFLICT (info_hash) DO UPDATE
   SET seeders = excluded.seeders, leechers = excluded.leechers,
       completed = excluded.completed, updated_at = excluded.updated_at;

INSERT INTO torrent_favorites (user_id, torrent_id, created_at)
SELECT (SELECT id FROM founder), s.torrent_id, s.created_at
  FROM s_favorites s
 WHERE EXISTS (SELECT 1 FROM torrents t WHERE t.id = s.torrent_id)
ON CONFLICT (user_id, torrent_id) DO NOTHING;

INSERT INTO torrent_moderation_messages (id, torrent_id, author_id, body, is_system, status_change, created_at)
SELECT s.id, s.torrent_id,
       CASE WHEN s.author_id IS NULL THEN NULL ELSE (SELECT id FROM founder) END,
       s.body, s.is_system, s.status_change, s.created_at
  FROM s_modmsgs s
 WHERE EXISTS (SELECT 1 FROM torrents t WHERE t.id = s.torrent_id)
ON CONFLICT (id) DO NOTHING;

-- L'obligation de seed va sur `plainuser` : c'est le compte depuis lequel on
-- regarde une page en tant que simple membre, et la carte d'obligation ne se
-- rend que pour le membre concerné.
INSERT INTO hnr_tracking (id, user_id, torrent_id, downloaded_at, seed_time,
       required_seed_time, is_hnr, is_exempt, completed_at, uploaded, downloaded)
SELECT s.id, (SELECT id FROM users WHERE username = 'plainuser' LIMIT 1), s.torrent_id,
       s.downloaded_at, s.seed_time, s.required_seed_time, s.is_hnr, s.is_exempt,
       s.completed_at, s.uploaded, s.downloaded
  FROM s_hnr s
 WHERE EXISTS (SELECT 1 FROM torrents t WHERE t.id = s.torrent_id)
   AND EXISTS (SELECT 1 FROM users u WHERE u.username = 'plainuser')
ON CONFLICT (user_id, torrent_id) DO NOTHING;

COMMIT;

SELECT 'categories' AS t, count(*) FROM categories
UNION ALL SELECT 'tags', count(*) FROM tags
UNION ALL SELECT 'torrents', count(*) FROM torrents
UNION ALL SELECT 'torrent_tags', count(*) FROM torrent_tags
UNION ALL SELECT 'torrent_comments', count(*) FROM torrent_comments
UNION ALL SELECT 'torrent_stats', count(*) FROM torrent_stats
UNION ALL SELECT 'torrent_favorites', count(*) FROM torrent_favorites
UNION ALL SELECT 'mod_messages', count(*) FROM torrent_moderation_messages
UNION ALL SELECT 'hnr_tracking', count(*) FROM hnr_tracking;
