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
	HTTPPort       int
	UDPPort        int
	UDPEnabled     bool
	DatabaseURL    string
	RedisURL       string
	RedisPassword  string
	RedisKeyPrefix string
	IPHashSecret   string
	Debug          bool
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
		UDPPort:        getEnvInt("TRACKER_UDP_PORT", 6969),
		UDPEnabled:     getEnvDefault("TRACKER_UDP_ENABLED", "true") == "true",
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		RedisURL:       os.Getenv("REDIS_URL"),
		RedisPassword:  os.Getenv("REDIS_PASSWORD"),
		RedisKeyPrefix: getEnvDefault("REDIS_KEY_PREFIX", "ot:"),
		IPHashSecret:   os.Getenv("IP_HASH_SECRET"),
		// 20 is what the pool was hardcoded to before this became a
		// setting; keeping it as the default means an existing deployment
		// behaves identically after the upgrade.
		DBMaxConns:        getEnvInt("TRACKER_DB_MAX_CONNS", 20),
		SynchronousCommit: getEnvDefault("TRACKER_SYNCHRONOUS_COMMIT", "off"),
		Debug:             os.Getenv("TRACKER_DEBUG") == "true",
		FederationSwarm:   getEnvDefault("TRACKER_FEDERATION_SWARM", "false") == "true",
		PeerTTL:           getEnvDuration("TRACKER_PEER_TTL", defaultPeerTTL),
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
