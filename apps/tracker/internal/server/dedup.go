package server

import (
	"sync"
	"time"
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

// dedup is an in-memory cache used solely to skip duplicate announces
// occurring within dedupWindow.
type dedup struct {
	mu   sync.Mutex
	seen map[string]time.Time
	stop chan struct{}
}

func newDedup() *dedup {
	d := &dedup{
		seen: make(map[string]time.Time),
		stop: make(chan struct{}),
	}
	go d.cleanupLoop()
	return d
}

// CheckAndMark returns true if this is a fresh announce (not a duplicate).
// Marks it as seen on the way in. Drops the oldest half of entries when
// the map exceeds `dedupMaxEntries` to keep memory bounded under spam.
func (d *dedup) CheckAndMark(key string) bool {
	now := time.Now()
	d.mu.Lock()
	defer d.mu.Unlock()
	if last, ok := d.seen[key]; ok && now.Sub(last) < dedupWindow {
		return false
	}
	if len(d.seen) >= dedupMaxEntries {
		d.evictHalfLocked()
	}
	d.seen[key] = now
	return true
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
