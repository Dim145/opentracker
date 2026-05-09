// Package bonus resolves the currently-active bonus event (Freeleech /
// Silverleech / custom multipliers) on behalf of the announce hot path.
//
// The API owns the canonical state (Postgres `bonus_events`) and writes
// a compact JSON snapshot to Redis under `<prefix>bonus:active` whenever
// the active row changes. This package reads that key with a small
// in-memory cache (30s) so we never hit Redis more than ~120 times per
// minute regardless of announce volume — and the multiplier lookup
// adds well under a microsecond on the cache-hit fast path.
//
// Multipliers are stored as basis points × 100, so the apply step is a
// plain integer multiplication: `delta * mul / 100`. No floating-point.
package bonus

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Default cache lifetime. The API stamps a 5-minute TTL on the Redis
// snapshot, so 30 s of staleness on the tracker side is well within
// the budget while keeping the operator's "I just toggled it off"
// expectation reasonable.
const defaultCacheTTL = 30 * time.Second

// Multipliers carries the currently-active scaling factors expressed
// as basis points (×100). A pair of `100`s is the no-op identity that
// the Apply method applies when no event is in flight.
type Multipliers struct {
	Download int
	Upload   int
}

// Identity is what callers see when no bonus event is active. Apply
// against it returns the input deltas unchanged.
var Identity = Multipliers{Download: 100, Upload: 100}

// Apply scales a pair of (deltaUp, deltaDown) byte counts by the
// upload / download multipliers. Integer-only — `delta * mul / 100`
// never introduces floating-point drift, and any rounding goes
// towards the user (we keep `int64` precision for the byte counts
// themselves).
func (m Multipliers) Apply(deltaUp, deltaDown int64) (int64, int64) {
	up := deltaUp * int64(m.Upload) / 100
	down := deltaDown * int64(m.Download) / 100
	return up, down
}

// snapshot mirrors the JSON shape the API writes to Redis. We only
// care about the multipliers and the window bounds — the title and
// id are useful for the user-facing UI but the tracker doesn't need
// them.
type snapshot struct {
	ID                 string `json:"id"`
	Title              string `json:"title"`
	DownloadMultiplier int    `json:"downloadMultiplier"`
	UploadMultiplier   int    `json:"uploadMultiplier"`
	StartsAtMs         int64  `json:"startsAtMs"`
	EndsAtMs           int64  `json:"endsAtMs"`
}

// Resolver is goroutine-safe; one instance per Server. Stash it in a
// field and call Get(ctx) before persisting user stats.
type Resolver struct {
	redis  *redis.Client
	prefix string
	ttl    time.Duration

	mu        sync.RWMutex
	cached    Multipliers
	expiresAt time.Time
}

// New builds a Resolver. `keyPrefix` should match the API's REDIS_KEY_PREFIX
// (default `ot:`) so the snapshot is read from `<prefix>bonus:active`.
func New(client *redis.Client, keyPrefix string) *Resolver {
	return &Resolver{
		redis:     client,
		prefix:    keyPrefix,
		ttl:       defaultCacheTTL,
		cached:    Identity,
		expiresAt: time.Time{},
	}
}

// SetTTL overrides the cache lifetime. Tests use this to force-refresh.
func (r *Resolver) SetTTL(d time.Duration) {
	r.ttl = d
}

func (r *Resolver) key() string { return r.prefix + "bonus:active" }

// Get returns the active multipliers, refreshing the cache if needed.
// Any Redis error fails open to Identity (1x/1x) so a Redis blip can
// never silently apply an outdated freeleech to a torrent.
func (r *Resolver) Get(ctx context.Context) Multipliers {
	now := time.Now()

	r.mu.RLock()
	if now.Before(r.expiresAt) {
		m := r.cached
		r.mu.RUnlock()
		return m
	}
	r.mu.RUnlock()

	// Slow path: fetch from Redis. We don't take the write lock until
	// we've got a fresh value — under contention, multiple goroutines
	// may all hit Redis once. That's fine; the alternative (single-
	// flight) adds complexity for negligible savings on a 30s window.
	raw, err := r.redis.Get(ctx, r.key()).Result()

	var fresh Multipliers
	if errors.Is(err, redis.Nil) {
		// Key absent → no active event. Cache the identity for the
		// full TTL so we don't pummel Redis between events.
		fresh = Identity
	} else if err != nil {
		// Network / auth error: fail open and shorten the TTL so the
		// next announce retries quickly.
		r.mu.Lock()
		r.cached = Identity
		r.expiresAt = now.Add(time.Second)
		r.mu.Unlock()
		return Identity
	} else {
		var s snapshot
		if json.Unmarshal([]byte(raw), &s) != nil {
			fresh = Identity
		} else if s.EndsAtMs <= now.UnixMilli() {
			// Snapshot's window has ended even though the API hasn't
			// re-resolved yet (clock skew, missed mutation). Don't
			// honour it — fail open to identity.
			fresh = Identity
		} else if s.DownloadMultiplier < 0 || s.UploadMultiplier < 0 {
			// Defensive: a corrupted JSON could underflow the int64
			// multiplication and bleed bytes. Identity is safer.
			fresh = Identity
		} else {
			fresh = Multipliers{
				Download: s.DownloadMultiplier,
				Upload:   s.UploadMultiplier,
			}
		}
	}

	r.mu.Lock()
	r.cached = fresh
	r.expiresAt = now.Add(r.ttl)
	r.mu.Unlock()
	return fresh
}
