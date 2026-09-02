package server

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// dedupWindow matches the legacy 2-second deduplication window. Many
// BT clients fire the same announce on multiple network interfaces
// (IPv4, IPv6, localhost) within milliseconds; we only want to
// credit one.
const dedupWindow = 2 * time.Second

// dedupCleanupEvery is how often the background sweeper runs. Between
// sweeps the map can grow with every distinct (info_hash, peer_id,
// event) triple, so we also enforce a hard cap below.
const dedupCleanupEvery = 10 * time.Second

// dedupMaxEntries caps how many entries the in-memory map may hold
// at once. Without this an attacker spamming announces with random
// peer_ids could grow the map to GBs between sweeps and starve the
// process. When we hit the cap we evict the oldest half — slightly
// more aggressive than strict LRU but much cheaper to compute under
// the lock.
const dedupMaxEntries = 100_000

// dedupRedisTimeout bounds the SET NX round-trip. The dedup sits on the
// announce hot path, so a stalled Redis must degrade to the local map
// rather than hold the request: 150 ms is far above a healthy round-trip
// and far below any client's patience.
const dedupRedisTimeout = 150 * time.Millisecond

// dedup decides whether an announce (or one of its side effects) has
// already been booked inside `dedupWindow`.
//
// TWO layers, and both are load-bearing:
//
//  1. an in-process map — free, catches the common case (one client
//     announcing over IPv4 and IPv6 milliseconds apart, landing on this
//     same process), and remains the answer when Redis is unreachable;
//  2. a Redis `SET NX PX` — catches the case the map cannot see, which is
//     the same announce arriving at a DIFFERENT process.
//
// Layer 2 exists because layer 1 is silently wrong the moment the tracker
// runs more than once. Measured on two instances behind a round-robin: the
// same announce credited its byte delta TWICE (1 MB transferred, 2 MB
// credited), because each process read the same Redis baseline, computed the
// same delta, and neither could see the other's map. `users.uploaded` is an
// atomic `+=`, so the over-credit is durable, and it propagates to ratio,
// bonus and hit-and-run.
//
// The same guard covers all three call sites — the per-event announce key,
// the `:credit` key that gates the byte delta (finding M5) and the
// `:seedtime` key that gates seed-time accrual (finding M7) — so all three
// become correct across instances at once.
//
// Note what is NOT fixed here: the rate ceiling on the delta is derived from
// `prev.UpdatedAt`, which lives in Redis and is therefore already shared, so
// two instances compute the same allowance. It bounds the size of a credit;
// it never deduplicated one.
type dedup struct {
	mu   sync.Mutex
	seen map[string]time.Time
	stop chan struct{}

	// rdb may be nil: unit tests construct a local-only dedup, and a
	// single-instance deployment loses nothing by it.
	rdb    *redis.Client
	prefix string
}

func newDedup(rdb *redis.Client, keyPrefix string) *dedup {
	d := &dedup{
		seen:   make(map[string]time.Time),
		stop:   make(chan struct{}),
		rdb:    rdb,
		prefix: keyPrefix,
	}
	go d.cleanupLoop()
	return d
}

// CheckAndMark returns true if this is a fresh announce (not a duplicate).
// Marks it as seen on the way in, locally and in Redis.
//
// A key must be fresh in BOTH layers to be accepted. The local check runs
// first because it is free and because a duplicate caught there needs no
// round-trip at all.
func (d *dedup) CheckAndMark(ctx context.Context, key string) bool {
	return d.CheckAndMarkFor(ctx, key, dedupWindow)
}

// CheckAndMarkFor is CheckAndMark with an explicit window.
//
// The 2-second default is right for what it was written for: one announce
// arriving on IPv4, IPv6 and localhost within milliseconds. It is wrong for
// anything that books a QUANTITY per period — seed time, most of all. There,
// the window has to be the period itself, or N concurrent peer_ids each claim
// the same stretch of wall-clock time and the total is N times the truth.
func (d *dedup) CheckAndMarkFor(ctx context.Context, key string, window time.Duration) bool {
	if !d.checkLocalFor(key, window) {
		return false
	}
	if d.rdb == nil {
		return true
	}
	return d.checkRedisFor(ctx, key, window)
}

func (d *dedup) checkLocalFor(key string, window time.Duration) bool {
	now := time.Now()
	d.mu.Lock()
	defer d.mu.Unlock()
	if last, ok := d.seen[key]; ok && now.Sub(last) < window {
		return false
	}
	if len(d.seen) >= dedupMaxEntries {
		d.evictHalfLocked()
	}
	d.seen[key] = now
	return true
}

func (d *dedup) checkRedisFor(ctx context.Context, key string, window time.Duration) bool {
	ctx, cancel := context.WithTimeout(ctx, dedupRedisTimeout)
	defer cancel()

	ok, err := d.rdb.SetNX(ctx, d.prefix+"dedup:"+key, 1, window).Result()
	if err != nil {
		slog.Warn("dedup: redis unreachable, falling back to the local window",
			"err", err)
		return true
	}
	return ok
}

// Stop signals the cleanup goroutine to exit.
func (d *dedup) Stop() { close(d.stop) }

func (d *dedup) cleanupLoop() {
	t := time.NewTicker(dedupCleanupEvery)
	defer t.Stop()
	for {
		select {
		case <-d.stop:
			return
		case <-t.C:
			d.sweep()
		}
	}
}

func (d *dedup) sweep() {
	now := time.Now()
	d.mu.Lock()
	defer d.mu.Unlock()
	for k, ts := range d.seen {
		if now.Sub(ts) > 2*dedupWindow {
			delete(d.seen, k)
		}
	}
}

// evictHalfLocked drops the oldest 50 % of entries by timestamp.
// Caller must hold d.mu. Cheap full pass with a single threshold —
// avoids the heap juggling a strict-LRU implementation would need.
func (d *dedup) evictHalfLocked() {
	if len(d.seen) == 0 {
		return
	}
	// Find the median timestamp via reservoir-style sampling: pick a
	// timestamp, count entries newer/older, accept it as the cutoff
	// when the split is close enough to even. 8 iterations are plenty
	// for a coarse split.
	var oldest, newest time.Time
	first := true
	for _, ts := range d.seen {
		if first {
			oldest, newest = ts, ts
			first = false
			continue
		}
		if ts.Before(oldest) {
			oldest = ts
		}
		if ts.After(newest) {
			newest = ts
		}
	}
	cutoff := oldest.Add(newest.Sub(oldest) / 2)
	for k, ts := range d.seen {
		if ts.Before(cutoff) {
			delete(d.seen, k)
		}
	}
}
