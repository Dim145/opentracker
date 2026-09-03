// Package config loads the tracker configuration from environment variables.
package config

import (
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPPort         int
	UDPPort          int
	UDPEnabled       bool
	UDPScrapeEnabled bool
	DatabaseURL      string
	RedisURL         string
	RedisPassword    string
	RedisKeyPrefix   string
	IPHashSecret     string
	Debug            bool
	// FederationSwarm gates the cross-announce peer injection (Phase 4).
	// Off by default — mixing partner-instance peers into responses re-opens
	// the private swarm isolation, so it's an explicit operator opt-in.
	FederationSwarm bool
	// PeerTTL is how long a peer entry survives in Redis without being
	// touched by an announce. Anything below the announce interval would
	// silently zero every delta on the next announce, so the loader
	// clamps to a sane minimum (see minPeerTTL in peers.go).
	PeerTTL time.Duration
	// DBMaxConns caps this instance's Postgres pool.
	//
	// It is per INSTANCE, which is the whole reason it is configurable: run
	// four trackers behind a load balancer and the cluster opens 4 × this
	// many connections, before counting the API's own replicas. PgBouncer's
	// `default_pool_size` and Postgres's `max_connections` have to be sized
	// for the product, and the only way to tune the other side of it was
	// previously to edit the source.
	DBMaxConns int
	// SynchronousCommit is the `synchronous_commit` level the tracker's own
	// pool runs at — `on`, `off` or `local`.
	//
	// Default `off`, which is a deliberate change of durability and worth
	// understanding. Every write the tracker makes is a counter or a piece of
	// telemetry: byte deltas, seed time, anti-cheat flags, the lazy unban. With
	// `off`, a crash can lose the last few hundred milliseconds of those (the
	// window is `wal_writer_delay`, 200 ms by default) — while the announce
	// path already forfeits up to a whole announce interval of credit whenever
	// a peer's Redis baseline has expired. The system's own tolerance is three
	// orders of magnitude coarser than what this gives up, and in exchange the
	// fsync leaves the commit path of the hottest writes in the deployment.
	//
	// Set it back to `on` if that trade is not yours to make. It applies ONLY
	// to the tracker's connections; the API keeps full durability.
	SynchronousCommit string
	// StatsFlushInterval est la fenêtre de regroupement des crédits d'octets
	// avant leur versement dans `users`. Zéro rend au chemin son écriture par
	// annonce.
	//
	// Ce qu'elle achète, mesuré sur cinq minutes de trafic à 1 964 annonces
	// créditées par seconde et 50 000 membres (voir internal/stats) :
	//
	//	désactivé   113–125 Mo de WAL   589 200 écritures de ligne
	//	60 s          45,8 Mo            226 315
	//	300 s          7,5 Mo             50 000
	//
	// Ce qu'elle coûte : `users.uploaded` et `users.downloaded` accusent
	// jusqu'à une fenêtre de retard. Le seul garde qui les lit est la porte de
	// ratio de l'annonce, qui voit déjà une valeur vieille de 60 s (le cache de
	// passkey) et ne se répète, par torrent, qu'à chaque intervalle d'annonce
	// — 1 800 s. Le défaut de 60 s reste donc dans le bruit de l'existant ;
	// au-delà, le retard devient visible pour le membre sur son propre profil.
	StatsFlushInterval time.Duration
	// StatsFlushChunk est le nombre de membres écrits par transaction lors
	// d'un versement.
	//
	// Ce n'est pas un réglage de confort : un versement d'un seul bloc empêche
	// l'élagage HOT de recycler la place en page et écrit PLUS de WAL que les
	// écritures unitaires qu'il remplace (45 317 lignes d'un bloc : 19 % de
	// HOT, 50 Mo ; par tranches de dix : 99,8 % de HOT, 20 Mo). Le défaut est
	// le creux de la courbe mesurée.
	StatsFlushChunk int
}

// defaultStatsFlushInterval / defaultStatsFlushChunk : voir les champs
// correspondants de `Config` pour les mesures qui fixent ces valeurs.
const (
	defaultStatsFlushInterval = 60 * time.Second
	defaultStatsFlushChunk    = 10
)

// statsFlushInterval lit `TRACKER_STATS_FLUSH_INTERVAL`.
//
// Séparé de `getEnvDuration` parce que celui-ci traite une durée nulle comme
// une valeur invalide et retombe sur le défaut. Ici zéro est une DEMANDE —
// « écris chaque annonce tout de suite » — et l'ignorer laisserait un
// opérateur croire qu'il a désactivé le regroupement alors qu'il tourne.
func statsFlushInterval() time.Duration {
	v := os.Getenv("TRACKER_STATS_FLUSH_INTERVAL")
	if v == "" {
		return defaultStatsFlushInterval
	}
	d, err := time.ParseDuration(v)
	if err != nil || d < 0 {
		slog.Warn("invalid duration in env, using default",
			"key", "TRACKER_STATS_FLUSH_INTERVAL", "value", v, "default", defaultStatsFlushInterval)
		return defaultStatsFlushInterval
	}
	return d
}

// defaultPeerTTL is the fallback applied when `TRACKER_PEER_TTL` is unset
// or empty. 24 h leaves room for laptops that sleep, mobile clients
// reconnecting through NAT, and short tracker outages — all without
// dropping the peer's previous announce snapshot. Operators with very
// large swarms can shorten it to reclaim Redis memory; smaller deployments
// can extend it further to be even more forgiving.
const defaultPeerTTL = 24 * time.Hour

// Load reads configuration from the environment. Required fields without
// values cause an error (we refuse to start with broken security defaults).
func Load() (*Config, error) {
	cfg := &Config{
		HTTPPort: getEnvInt("TRACKER_HTTP_PORT", 8080),
		// 6969 is the de-facto BEP 15 port; we keep it as default so a
		// `udp://tracker.example.com:6969` URL works without operator
		// tweaking. UDP support is opt-in via TRACKER_UDP_ENABLED so an
		// operator who doesn't want to expose it (HTTPS-only deployments,
		// strict firewall rules, etc.) can keep the listener off.
		UDPPort:    getEnvInt("TRACKER_UDP_PORT", 6969),
		UDPEnabled: getEnvDefault("TRACKER_UDP_ENABLED", "true") == "true",
		// Le scrape UDP, séparément de l'annonce.
		//
		// Le scrape HTTP exige une passkey (voir `handleScrape` dans
		// `internal/server/handler.go`, et le pourquoi : reconstituer le
		// catalogue depuis une liste de hashes publics). Le scrape UDP ne le
		// peut pas — BEP 15 ne prévoit AUCUN emplacement pour une donnée
		// d'authentification dans une requête de scrape ; l'extension BEP 41
		// qui porte la passkey de l'annonce ne s'applique qu'à l'annonce.
		// Exiger une passkey ici reviendrait à casser le scrape UDP pour tous
		// les clients conformes.
		//
		// L'asymétrie est donc dans les protocoles, pas dans ce code. Ce qui
		// manquait, c'est le choix : un tracker privé qui ne veut pas publier
		// la taille de ses essaims peut désormais fermer le scrape sans perdre
		// l'annonce UDP. La contrainte réelle reste modeste — l'appelant doit
		// d'abord faire un `connect` depuis sa vraie adresse, et la réponse ne
		// contient que des compteurs, jamais de pairs.
		//
		// Défaut `true` : un déploiement existant ne change pas de
		// comportement en se mettant à jour.
		UDPScrapeEnabled: getEnvDefault("TRACKER_UDP_SCRAPE_ENABLED", "true") == "true",
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		RedisURL:         os.Getenv("REDIS_URL"),
		RedisPassword:    os.Getenv("REDIS_PASSWORD"),
		RedisKeyPrefix:   getEnvDefault("REDIS_KEY_PREFIX", "ot:"),
		IPHashSecret:     os.Getenv("IP_HASH_SECRET"),
		// 20 is what the pool was hardcoded to before this became a
		// setting; keeping it as the default means an existing deployment
		// behaves identically after the upgrade.
		DBMaxConns:        getEnvInt("TRACKER_DB_MAX_CONNS", 20),
		SynchronousCommit: getEnvDefault("TRACKER_SYNCHRONOUS_COMMIT", "off"),
		Debug:             os.Getenv("TRACKER_DEBUG") == "true",
		FederationSwarm:   getEnvDefault("TRACKER_FEDERATION_SWARM", "false") == "true",
		PeerTTL:           getEnvDuration("TRACKER_PEER_TTL", defaultPeerTTL),
		// `0s` désactive explicitement le regroupement. `getEnvDuration` refuse
		// les durées non positives et retomberait sur le défaut, d'où la
		// lecture séparée : une désactivation demandée doit être obtenue.
		StatsFlushInterval: statsFlushInterval(),
		StatsFlushChunk:    getEnvInt("TRACKER_STATS_FLUSH_CHUNK", defaultStatsFlushChunk),
	}

	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.RedisURL == "" {
		return nil, fmt.Errorf("REDIS_URL is required")
	}
	if cfg.IPHashSecret == "" {
		return nil, fmt.Errorf("IP_HASH_SECRET is required")
	}
	// IP_HASH_SECRET keys BOTH the IP/peer fingerprints and the BEP 15
	// connection-id HMAC. A short, low-entropy value would let an
	// attacker brute-force the fixed-salt IP hashes and forge
	// connection ids, so require at least 32 chars (findings:
	// IP_HASH_SECRET / connection-id key strength).
	if len(cfg.IPHashSecret) < 32 {
		return nil, fmt.Errorf("IP_HASH_SECRET must be at least 32 characters (got %d); generate one with `openssl rand -hex 32`", len(cfg.IPHashSecret))
	}

	return cfg, nil
}

func getEnvDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

// getEnvDuration parses a Go duration string (`24h`, `90m`, `7200s`, …).
// A malformed value or a non-positive duration falls back to the default
// and emits a warning, since silently honouring a bogus value would leave
// the operator with a tracker that drops every delta.
func getEnvDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil || d <= 0 {
		slog.Warn("invalid duration in env, using default",
			"key", key, "value", v, "default", fallback)
		return fallback
	}
	return d
}
