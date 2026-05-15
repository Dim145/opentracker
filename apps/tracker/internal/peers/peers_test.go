package peers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// injectPeer writes a PeerData entry straight into miniredis with the
// caller-chosen UpdatedAt. Used to test the TTL / active-window
// filtering without waiting on real time.
func injectPeer(t *testing.T, mr *miniredis.Miniredis, infoHash string, p PeerData) {
	t.Helper()
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	mr.HSet("ot:peers:"+infoHash, p.PeerID, string(raw))
}

// newTestStore returns a peers.Store backed by an in-process miniredis.
// The caller is responsible for closing the miniredis instance.
func newTestStore(t *testing.T, ttl time.Duration) (*Store, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	s := New(client, "ot:", ttl)
	return s, mr
}

func samplePeer(id, ip string, port uint16, seeder bool) *PeerData {
	return &PeerData{
		PeerID:   id,
		UserID:   "user-" + id,
		IP:       ip,
		IPHash:   "hash-" + id,
		Port:     port,
		IsSeeder: seeder,
	}
}

// ----------------------------------------------------------------------------
// New — TTL clamping
// ----------------------------------------------------------------------------

func TestNew_ClampsBelowMinPeerTTL(t *testing.T) {
	mr := miniredis.RunT(t)
	defer mr.Close()
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	s := New(client, "ot:", 1*time.Second) // way under minPeerTTL
	if s.peerTTL != minPeerTTL {
		t.Fatalf("peerTTL: got %v, want %v (clamped)", s.peerTTL, minPeerTTL)
	}
}

func TestNew_HonoursOperatorTTL(t *testing.T) {
	mr := miniredis.RunT(t)
	defer mr.Close()
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	s := New(client, "ot:", 2*time.Hour)
	if s.peerTTL != 2*time.Hour {
		t.Fatalf("peerTTL: got %v, want 2h", s.peerTTL)
	}
}

// ----------------------------------------------------------------------------
// Set + Get round-trip
// ----------------------------------------------------------------------------

func TestSetGet_RoundTrip(t *testing.T) {
	s, _ := newTestStore(t, 24*time.Hour)
	ctx := context.Background()

	p := samplePeer("abc", "203.0.113.10", 6881, true)
	if err := s.Set(ctx, "hash1", p); err != nil {
		t.Fatalf("Set: %v", err)
	}
	got, err := s.Get(ctx, "hash1", "abc")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got == nil {
		t.Fatal("Get returned nil")
	}
	if got.IP != "203.0.113.10" || got.Port != 6881 || !got.IsSeeder || got.UserID != "user-abc" {
		t.Fatalf("Get returned wrong payload: %+v", got)
	}
	// `Set` stamps `UpdatedAt` on every call.
	if got.UpdatedAt == 0 {
		t.Fatal("UpdatedAt was not stamped")
	}
}

func TestGet_UnknownPeer_ReturnsNil(t *testing.T) {
	s, _ := newTestStore(t, 24*time.Hour)
	p, err := s.Get(context.Background(), "no-hash", "no-peer")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if p != nil {
		t.Fatalf("expected nil, got %+v", p)
	}
}

func TestGet_CorruptedEntry_RemovedAndNil(t *testing.T) {
	s, mr := newTestStore(t, 24*time.Hour)
	// Inject a garbage JSON value under the proper key.
	mr.HSet("ot:peers:hash2", "peerX", "not json")
	got, err := s.Get(context.Background(), "hash2", "peerX")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil for corrupted entry, got %+v", got)
	}
	// Corrupted entry should have been HDel'd.
	// `HGet` on a missing field returns the empty string + an error
	// from miniredis; we just need to confirm the field is gone.
	if v := mr.HGet("ot:peers:hash2", "peerX"); v != "" {
		t.Fatal("corrupted entry was not pruned")
	}
}

// ----------------------------------------------------------------------------
// TTL enforcement
// ----------------------------------------------------------------------------

func TestGet_ExpiredEntry_ReturnedAsNil(t *testing.T) {
	s, mr := newTestStore(t, 30*time.Minute)
	ctx := context.Background()

	// Inject a peer whose UpdatedAt is older than peerTTL. We can't
	// just FastForward miniredis because the staleness check in
	// peers.Get compares against `time.Now()`, not the Redis clock.
	stale := PeerData{
		PeerID:    "p1",
		IP:        "203.0.113.1",
		Port:      1,
		IsSeeder:  true,
		UpdatedAt: time.Now().Add(-2 * time.Hour).UnixMilli(),
	}
	injectPeer(t, mr, "hashZ", stale)

	got, err := s.Get(ctx, "hashZ", "p1")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil after TTL, got %+v", got)
	}
}

// ----------------------------------------------------------------------------
// Remove
// ----------------------------------------------------------------------------

func TestRemove(t *testing.T) {
	s, _ := newTestStore(t, 24*time.Hour)
	ctx := context.Background()
	_ = s.Set(ctx, "h", samplePeer("p1", "203.0.113.1", 1, false))
	if err := s.Remove(ctx, "h", "p1"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	got, _ := s.Get(ctx, "h", "p1")
	if got != nil {
		t.Fatal("expected nil after Remove")
	}
}

// ----------------------------------------------------------------------------
// List + Counts + active-window filtering
// ----------------------------------------------------------------------------

func TestList_ReturnsAllActivePeers(t *testing.T) {
	s, _ := newTestStore(t, 24*time.Hour)
	ctx := context.Background()
	_ = s.Set(ctx, "h", samplePeer("p1", "203.0.113.1", 1, true))
	_ = s.Set(ctx, "h", samplePeer("p2", "203.0.113.2", 2, false))

	peers, err := s.List(ctx, "h")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(peers) != 2 {
		t.Fatalf("expected 2 peers, got %d", len(peers))
	}
}

func TestList_SkipsPeersBeyondActiveWindow(t *testing.T) {
	s, mr := newTestStore(t, 24*time.Hour) // long Redis TTL
	// activeListWindow + 1 min ago — outside the response window,
	// inside the Redis TTL.
	ghost := PeerData{
		PeerID:    "ghost",
		IP:        "203.0.113.1",
		Port:      1,
		IsSeeder:  true,
		UpdatedAt: time.Now().Add(-activeListWindow - time.Minute).UnixMilli(),
	}
	injectPeer(t, mr, "h", ghost)

	peers, err := s.List(context.Background(), "h")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	// Ghost should be filtered from the list, but NOT evicted from
	// Redis (peerTTL not yet hit — the entry is still useful as a
	// `prev` snapshot for the byte-delta computation).
	if len(peers) != 0 {
		t.Fatalf("expected 0 active peers, got %d", len(peers))
	}
	if v := mr.HGet("ot:peers:h", "ghost"); v == "" {
		t.Fatal("ghost should still be in Redis (within peerTTL)")
	}
}

func TestList_EvictsPeersBeyondPeerTTL(t *testing.T) {
	s, mr := newTestStore(t, 30*time.Minute)
	dead := PeerData{
		PeerID:    "dead",
		IP:        "203.0.113.1",
		Port:      1,
		IsSeeder:  true,
		UpdatedAt: time.Now().Add(-2 * time.Hour).UnixMilli(),
	}
	injectPeer(t, mr, "h", dead)

	peers, err := s.List(context.Background(), "h")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(peers) != 0 {
		t.Fatalf("expected 0 peers, got %d", len(peers))
	}
	// Past peerTTL → must be HDel'd from Redis.
	if v := mr.HGet("ot:peers:h", "dead"); v != "" {
		t.Fatal("dead peer should have been evicted")
	}
}

func TestList_DropsCorruptedEntries(t *testing.T) {
	s, mr := newTestStore(t, 24*time.Hour)
	mr.HSet("ot:peers:h", "good", `{"peerId":"good","ip":"203.0.113.5","port":6881,"updatedAt":`+nowMs(t)+`}`)
	mr.HSet("ot:peers:h", "bad", "totally not json")

	peers, err := s.List(context.Background(), "h")
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(peers) != 1 {
		t.Fatalf("expected 1 good peer, got %d", len(peers))
	}
}

func TestCounts_ClassifiesSeedersAndLeechers(t *testing.T) {
	s, _ := newTestStore(t, 24*time.Hour)
	ctx := context.Background()
	_ = s.Set(ctx, "h", samplePeer("s1", "203.0.113.1", 1, true))
	_ = s.Set(ctx, "h", samplePeer("s2", "203.0.113.2", 2, true))
	_ = s.Set(ctx, "h", samplePeer("l1", "203.0.113.3", 3, false))

	seeders, leechers, err := s.Counts(ctx, "h")
	if err != nil {
		t.Fatalf("Counts: %v", err)
	}
	if seeders != 2 || leechers != 1 {
		t.Fatalf("got (%d, %d), want (2, 1)", seeders, leechers)
	}
}

func TestCounts_CacheRespectsTTL(t *testing.T) {
	s, _ := newTestStore(t, 24*time.Hour)
	ctx := context.Background()
	_ = s.Set(ctx, "h", samplePeer("p1", "203.0.113.1", 1, true))

	// First call populates the cache.
	seeders1, _, _ := s.Counts(ctx, "h")
	if seeders1 != 1 {
		t.Fatalf("first Counts: got %d seeders, want 1", seeders1)
	}
	// Add another peer; Set() invalidates the counts cache so the
	// next Counts() reflects it.
	_ = s.Set(ctx, "h", samplePeer("p2", "203.0.113.2", 2, true))
	seeders2, _, _ := s.Counts(ctx, "h")
	if seeders2 != 2 {
		t.Fatalf("after Set: got %d seeders, want 2 (cache must invalidate)", seeders2)
	}
}

// ----------------------------------------------------------------------------
// Completed counter
// ----------------------------------------------------------------------------

func TestIncrementCompleted_FromZero(t *testing.T) {
	s, _ := newTestStore(t, 24*time.Hour)
	ctx := context.Background()
	if err := s.IncrementCompleted(ctx, "h"); err != nil {
		t.Fatalf("IncrementCompleted: %v", err)
	}
	n, err := s.CompletedCount(ctx, "h")
	if err != nil {
		t.Fatalf("CompletedCount: %v", err)
	}
	if n != 1 {
		t.Fatalf("got %d, want 1", n)
	}
}

func TestIncrementCompleted_Accumulates(t *testing.T) {
	s, _ := newTestStore(t, 24*time.Hour)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		_ = s.IncrementCompleted(ctx, "h")
	}
	n, _ := s.CompletedCount(ctx, "h")
	if n != 5 {
		t.Fatalf("got %d, want 5", n)
	}
}

func TestCompletedCount_NeverIncrementedYields0(t *testing.T) {
	s, _ := newTestStore(t, 24*time.Hour)
	n, err := s.CompletedCount(context.Background(), "no-hash")
	if err != nil {
		t.Fatalf("CompletedCount: %v", err)
	}
	if n != 0 {
		t.Fatalf("got %d, want 0", n)
	}
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

func nowMs(t *testing.T) string {
	t.Helper()
	ms := time.Now().UnixMilli()
	// itoa without strconv pull-in.
	return formatInt(ms)
}

func formatInt(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
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
