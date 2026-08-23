package server

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestDedup_FirstCall_ReturnsTrue(t *testing.T) {
	ctx := context.Background()
	d := newDedup(nil, "ot:")
	defer d.Stop()
	if !d.CheckAndMark(ctx, "k1") {
		t.Fatal("first CheckAndMark should return true")
	}
}

func TestDedup_DuplicateWithinWindow_ReturnsFalse(t *testing.T) {
	ctx := context.Background()
	d := newDedup(nil, "ot:")
	defer d.Stop()
	d.CheckAndMark(ctx, "k1")
	if d.CheckAndMark(ctx, "k1") {
		t.Fatal("second CheckAndMark within the window should return false (dup)")
	}
}

func TestDedup_DifferentKeysIndependent(t *testing.T) {
	ctx := context.Background()
	d := newDedup(nil, "ot:")
	defer d.Stop()
	if !d.CheckAndMark(ctx, "a") {
		t.Fatal("a: first should be true")
	}
	if !d.CheckAndMark(ctx, "b") {
		t.Fatal("b: first should be true (independent key)")
	}
	if d.CheckAndMark(ctx, "a") {
		t.Fatal("a: second should be dup")
	}
}

// TestDedup_AfterWindowExpires re-uses the same key once the window
// has passed. The dedupWindow is 2 s in production, but we can fake
// time by injecting an old timestamp directly into the map under the
// lock.
func TestDedup_AfterWindowExpires(t *testing.T) {
	ctx := context.Background()
	d := newDedup(nil, "ot:")
	defer d.Stop()
	d.CheckAndMark(ctx, "k1")

	d.mu.Lock()
	d.seen["k1"] = time.Now().Add(-2 * dedupWindow) // long ago
	d.mu.Unlock()

	if !d.CheckAndMark(ctx, "k1") {
		t.Fatal("after window: should accept as fresh")
	}
}

// TestDedup_EvictsWhenOverflow simulates the spam protection: when
// the map exceeds dedupMaxEntries, the eviction kicks in and drops
// the older half. We don't try to populate 100k entries (slow);
// we shrink the cap conceptually by checking the eviction code on
// a small set with one stale entry.
func TestDedup_EvictHalfLocked(t *testing.T) {
	d := newDedup(nil, "ot:")
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
	d := newDedup(nil, "ot:")
	defer d.Stop()
	d.mu.Lock()
	d.evictHalfLocked() // no-op
	d.mu.Unlock()
}

// TestDedup_Sweep ensures the periodic sweep removes entries older
// than 2× the window.
func TestDedup_Sweep(t *testing.T) {
	d := newDedup(nil, "ot:")
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
	ctx := context.Background()
	d := newDedup(nil, "ot:")
	defer d.Stop()

	var wg sync.WaitGroup
	var accepted, rejected int64
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				if d.CheckAndMark(ctx, itoa(i*1000+j)) {
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

// TestDedup_CrossInstance is the test the outage was missing.
//
// Two `dedup` values stand in for two tracker processes behind a load
// balancer: separate in-memory maps, one shared Redis. The same key must be
// accepted exactly once across BOTH, which is what stops the same announce
// crediting its byte delta twice.
//
// Measured before the Redis layer existed: 1 MB transferred, 2 MB credited.
func TestDedup_CrossInstance(t *testing.T) {
	ctx := context.Background()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	a := newDedup(client, "ot:")
	defer a.Stop()
	b := newDedup(client, "ot:")
	defer b.Stop()

	if !a.CheckAndMark(ctx, "hash:peer:credit") {
		t.Fatal("instance A: first call should be fresh")
	}
	if b.CheckAndMark(ctx, "hash:peer:credit") {
		t.Fatal("instance B: the SAME key must be a duplicate — this is the double-credit bug")
	}
	// A different key is unaffected: the guard must not become a global lock.
	if !b.CheckAndMark(ctx, "hash:other-peer:credit") {
		t.Fatal("instance B: a distinct key should be fresh")
	}
}

// TestDedup_CrossInstance_WindowExpires proves the Redis claim self-expires,
// so a peer announcing every 30 minutes is never mistaken for a duplicate.
func TestDedup_CrossInstance_WindowExpires(t *testing.T) {
	ctx := context.Background()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	a := newDedup(client, "ot:")
	defer a.Stop()
	b := newDedup(client, "ot:")
	defer b.Stop()

	if !a.CheckAndMark(ctx, "k") {
		t.Fatal("A: first should be fresh")
	}
	mr.FastForward(dedupWindow + time.Second)
	if !b.CheckAndMark(ctx, "k") {
		t.Fatal("B: after the window the key must be claimable again")
	}
}

// TestDedup_RedisDown_FallsBackToLocal keeps the degradation honest: with
// Redis unreachable the guard must behave exactly as it did before this
// layer existed — protective within a process, silent across them — rather
// than dropping a member's bytes.
func TestDedup_RedisDown_FallsBackToLocal(t *testing.T) {
	ctx := context.Background()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	d := newDedup(client, "ot:")
	defer d.Stop()
	mr.Close() // pull the plug

	if !d.CheckAndMark(ctx, "k") {
		t.Fatal("with Redis down the first call must still be accepted")
	}
	if d.CheckAndMark(ctx, "k") {
		t.Fatal("with Redis down the local window must still catch the duplicate")
	}
}
