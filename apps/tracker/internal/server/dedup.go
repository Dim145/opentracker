package server

import (
	"sync"
	"time"
)

// dedupWindow matches the legacy 2-second deduplication window. Many BT
// clients fire the same announce on multiple network interfaces (IPv4,
// IPv6, localhost) within milliseconds; we only want to credit one of them.
const dedupWindow = 2 * time.Second

// dedupCleanupEvery is how often we sweep stale entries.
const dedupCleanupEvery = 10 * time.Second

// dedup is an in-memory cache used solely to skip duplicate announces
// occurring within dedupWindow. Memory grows linearly with active peers
// but the periodic sweep keeps it bounded.
type dedup struct {
	mu    sync.Mutex
	seen  map[string]time.Time
	stop  chan struct{}
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
// Marks it as seen on the way in.
func (d *dedup) CheckAndMark(key string) bool {
	now := time.Now()
	d.mu.Lock()
	defer d.mu.Unlock()
	if last, ok := d.seen[key]; ok && now.Sub(last) < dedupWindow {
		return false
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
