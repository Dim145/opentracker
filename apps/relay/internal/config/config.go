// Package config holds what the relay is told, from two sources.
//
// The environment carries what cannot change while the process runs — where
// Valkey is, what secret verifies tokens, which port to listen on. Anything
// that depends on the size of the fleet arrives at runtime from the API,
// because the relay has no way of knowing how many of itself there are.
package config

import (
	"errors"
	"os"
	"strconv"
	"sync/atomic"
	"time"
)

// Static is read once, at boot.
type Static struct {
	Addr      string
	ValkeyURL string
	// Kept out of the URL on purpose: the URL is logged on a connection
	// failure, and a password in it would be logged with it.
	ValkeyPass   string
	TokenSecret  []byte
	NodeID       string
	AllowOrigin  string
	RegisterTTL  time.Duration
	RefreshEvery time.Duration
}

// Dynamic is what the API recomputes whenever the fleet changes size, and
// publishes to every node. Held in an atomic so the HTTP handlers read it
// without a lock on every connection.
type Dynamic struct {
	MaxConnections   int `json:"maxConnections"`
	QueueDepth       int `json:"queueDepth"`
	CoalesceWindowMs int `json:"coalesceWindowMs"`
}

// Defaults are what a node applies when it has heard nothing yet.
//
// This is not a placeholder. A node that has not received its configuration
// must serve, not refuse: the configuration is an optimisation, never an
// authorisation. A relay that turned everybody away because the API was
// slow to start would turn a config delay into an outage.
func Defaults() Dynamic {
	return Dynamic{MaxConnections: 5000, QueueDepth: 64, CoalesceWindowMs: 150}
}

type Live struct{ v atomic.Pointer[Dynamic] }

func NewLive() *Live {
	l := &Live{}
	d := Defaults()
	l.v.Store(&d)
	return l
}

func (l *Live) Get() Dynamic { return *l.v.Load() }

// Set applies an update, with one rule the fleet depends on: a lowered
// ceiling never evicts. It applies to connections that have not been made
// yet, so growing the fleet cannot knock existing readers off.
/*
 * Des plafonds, et pas seulement des planchers.
 *
 * Ces valeurs arrivent d'un `PUBLISH` Valkey, et `QueueDepth` dimensionne
 * directement `make(chan []byte, …)` à CHAQUE nouvelle connexion. Seules les
 * valeurs `<= 0` étaient corrigées : un `queueDepth: 67108864` accepté tel quel
 * portait le tampon de chaque flux à environ 1,5 Gio, et le premier lecteur qui
 * se connectait faisait tomber le nœud.
 *
 * Cela demande un accès à Valkey, donc c'est du durcissement en profondeur —
 * mais c'est exactement la forme « allocation pilotée par l'entrée », et une
 * configuration valable pour toute la flotte est le dernier endroit où faire
 * confiance. `Defaults()` prouve d'ailleurs que les bornes utiles sont connues.
 */
const (
	maxQueueDepth       = 4096
	maxMaxConnections   = 100_000
	maxCoalesceWindowMs = 5_000
)

func (l *Live) Set(d Dynamic) {
	if d.MaxConnections <= 0 || d.MaxConnections > maxMaxConnections {
		d.MaxConnections = Defaults().MaxConnections
	}
	if d.QueueDepth <= 0 || d.QueueDepth > maxQueueDepth {
		d.QueueDepth = Defaults().QueueDepth
	}
	if d.CoalesceWindowMs < 0 || d.CoalesceWindowMs > maxCoalesceWindowMs {
		d.CoalesceWindowMs = Defaults().CoalesceWindowMs
	}
	l.v.Store(&d)
}

func LoadStatic() (Static, error) {
	s := Static{
		Addr:         env("RELAY_ADDR", ":4100"),
		ValkeyURL:    os.Getenv("REDIS_URL"),
		ValkeyPass:   os.Getenv("REDIS_PASSWORD"),
		TokenSecret:  []byte(os.Getenv("MESSAGING_TOKEN_SECRET")),
		NodeID:       env("RELAY_NODE_ID", hostnameOr("relay")),
		AllowOrigin:  os.Getenv("RELAY_ALLOW_ORIGIN"),
		RegisterTTL:  30 * time.Second,
		RefreshEvery: 10 * time.Second,
	}
	if s.ValkeyURL == "" {
		return s, errors.New("REDIS_URL is required")
	}
	// Refusing to boot is right here, and it is the opposite of the rule
	// above: an unset secret is not a missing optimisation, it is a relay
	// that would accept forged tokens.
	if len(s.TokenSecret) < 32 {
		return s, errors.New("MESSAGING_TOKEN_SECRET must be at least 32 bytes")
	}
	return s, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func hostnameOr(fallback string) string {
	if h, err := os.Hostname(); err == nil && h != "" {
		return h
	}
	return fallback + strconv.FormatInt(time.Now().UnixNano(), 36)
}
