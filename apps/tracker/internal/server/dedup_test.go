package server

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDedup_FirstCall_ReturnsTrue(t *testing.T) {
	d := newDedup()
	defer d.Stop()
	if !d.CheckAndMark("k1") {
		t.Fatal("first CheckAndMark should return true")
	}
}

func TestDedup_DuplicateWithinWindow_ReturnsFalse(t *testing.T) {
	d := newDedup()
	defer d.Stop()
	d.CheckAndMark("k1")
	if d.CheckAndMark("k1") {
		t.Fatal("second CheckAndMark within the window should return false (dup)")
	}
}

func TestDedup_DifferentKeysIndependent(t *testing.T) {
	d := newDedup()
	defer d.Stop()
	if !d.CheckAndMark("a") {
		t.Fatal("a: first should be true")
	}
	if !d.CheckAndMark("b") {
		t.Fatal("b: first should be true (independent key)")
	}
	if d.CheckAndMark("a") {
		t.Fatal("a: second should be dup")
	}
}

// TestDedup_AfterWindowExpires re-uses the same key once the window
// has passed. The dedupWindow is 2 s in production, but we can fake
// time by injecting an old timestamp directly into the map under the
// lock.
func TestDedup_AfterWindowExpires(t *testing.T) {
	d := newDedup()
	defer d.Stop()
	d.CheckAndMark("k1")

	d.mu.Lock()
	d.seen["k1"] = time.Now().Add(-2 * dedupWindow) // long ago
	d.mu.Unlock()

	if !d.CheckAndMark("k1") {
		t.Fatal("after window: should accept as fresh")
	}
}

// TestDedup_EvictsWhenOverflow simulates the spam protection: when
// the map exceeds dedupMaxEntries, the eviction kicks in and drops
// the older half. We don't try to populate 100k entries (slow);
// we shrink the cap conceptually by checking the eviction code on
// a small set with one stale entry.
func TestDedup_EvictHalfLocked(t *testing.T) {
	d := newDedup()
	defer d.Stop()

	d.mu.Lock()
	now := time.Now()
	for i := 0; i < 100; i++ {
		// First half: old timestamps. Second half: fresh.
		var ts time.Time
		if i < 50 {
			ts = now.Add(-time.Hour)
		} else {
			ts = now
		}
		d.seen[itoa(i)] = ts
	}
	d.evictHalfLocked()
	remaining := len(d.seen)
	d.mu.Unlock()

	if remaining == 0 || remaining == 100 {
		t.Fatalf("eviction surprising: got %d / 100", remaining)
	}
	// Old timestamps should be the ones dropped.
	if _, ok := d.seen["0"]; ok {
		t.Fatal("old entry should have been evicted")
	}
}

func TestDedup_EvictHalf_EmptyMap_NoCrash(t *testing.T) {
	d := newDedup()
	defer d.Stop()
	d.mu.Lock()
	d.evictHalfLocked() // no-op
	d.mu.Unlock()
}

// TestDedup_Sweep ensures the periodic sweep removes entries older
// than 2× the window.
func TestDedup_Sweep(t *testing.T) {
	d := newDedup()
	defer d.Stop()

	d.mu.Lock()
	d.seen["fresh"] = time.Now()
	d.seen["old"] = time.Now().Add(-3 * dedupWindow)
	d.mu.Unlock()

	d.sweep()

	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.seen["fresh"]; !ok {
		t.Fatal("fresh entry should survive sweep")
	}
	if _, ok := d.seen["old"]; ok {
		t.Fatal("old entry should have been swept")
	}
}

// TestDedup_ConcurrentSafe hammers CheckAndMark from many goroutines
// to make sure the mutex coverage is correct. Run with `-race` to
// surface any unprotected access.
func TestDedup_ConcurrentSafe(t *testing.T) {
	d := newDedup()
	defer d.Stop()

	var wg sync.WaitGroup
	var accepted, rejected int64
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				if d.CheckAndMark(itoa(i*1000 + j)) {
					atomic.AddInt64(&accepted, 1)
				} else {
					atomic.AddInt64(&rejected, 1)
				}
			}
		}(i)
	}
	wg.Wait()
	// All 5000 keys are distinct so all should be accepted.
	if accepted != 5000 {
		t.Fatalf("accepted: got %d, want 5000", accepted)
	}
	if rejected != 0 {
		t.Fatalf("rejected: got %d, want 0", rejected)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [12]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
