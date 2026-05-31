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
// ListRemote — federation cross-announce cache (Phase 4)
// ----------------------------------------------------------------------------

// setRemote writes the raw value of a remote_peers:{hash} key straight into
// miniredis, mirroring what the API's federation sync produces.
func setRemote(t *testing.T, mr *miniredis.Miniredis, infoHash, raw string) {
	t.Helper()
	mr.Set("ot:remote_peers:"+infoHash, raw)
}

// TestListRemote_TableDriven exercises the read+unmarshal contract of
// ListRemote against a live (in-process) miniredis: a missing key, a
// well-formed JSON array, an empty array, and malformed JSON. In every
// failure mode ListRemote must return (nil, nil) and never panic —
// cross-announce is strictly best-effort.
func TestListRemote_TableDriven(t *testing.T) {
	tests := []struct {
		name string
		// store, when non-empty, is written verbatim to the
		// remote_peers key before the call. When empty, the key is
		// left absent (cache-miss case).
		store    string
		setKey   bool
		wantLen  int
		wantNil  bool
		validate func(t *testing.T, got []*PeerData)
	}{
		{
			name:    "cache miss — key absent returns nil",
			setKey:  false,
			wantNil: true,
		},
		{
			name:    "stored JSON array parses into peers",
			setKey:  true,
			store:   `[{"peerId":"a","ip":"198.51.100.1","port":6881,"isSeeder":true},{"peerId":"b","ip":"198.51.100.2","port":6882,"isSeeder":false}]`,
			wantLen: 2,
			validate: func(t *testing.T, got []*PeerData) {
				if got[0].IP != "198.51.100.1" || got[0].Port != 6881 || !got[0].IsSeeder {
					t.Errorf("peer[0] mis-parsed: %+v", got[0])
				}
				if got[1].IP != "198.51.100.2" || got[1].Port != 6882 || got[1].IsSeeder {
					t.Errorf("peer[1] mis-parsed: %+v", got[1])
				}
			},
		},
		{
			name:    "empty JSON array yields zero peers (non-nil, no error)",
			setKey:  true,
			store:   `[]`,
			wantLen: 0,
		},
		{
			name:    "malformed JSON returns nil without panicking",
			setKey:  true,
			store:   `{not valid json`,
			wantNil: true,
		},
		{
			name:    "JSON object (wrong shape) returns nil",
			setKey:  true,
			store:   `{"peerId":"a","ip":"198.51.100.1"}`,
			wantNil: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, mr := newTestStore(t, 24*time.Hour)
			if tt.setKey {
				setRemote(t, mr, "fed-hash", tt.store)
			}
			got, err := s.ListRemote(context.Background(), "fed-hash")
			if err != nil {
				t.Fatalf("ListRemote returned error (must be best-effort nil): %v", err)
			}
			if tt.wantNil {
				if got != nil {
					t.Fatalf("expected nil, got %+v", got)
				}
				return
			}
			if len(got) != tt.wantLen {
				t.Fatalf("len: got %d, want %d (%+v)", len(got), tt.wantLen, got)
			}
			if tt.validate != nil {
				tt.validate(t, got)
			}
		})
	}
}

// TestListRemote_CacheHitSkipsRedis proves the second call within
// remoteCacheTTL is served from the process-local cache and does NOT
// re-read Redis: we populate the cache, then change the underlying key,
// and assert the stale (cached) value is still returned.
func TestListRemote_CacheHitSkipsRedis(t *testing.T) {
	s, mr := newTestStore(t, 24*time.Hour)
	ctx := context.Background()

	setRemote(t, mr, "h", `[{"peerId":"a","ip":"198.51.100.1","port":6881}]`)

	first, err := s.ListRemote(ctx, "h")
	if err != nil {
		t.Fatalf("first ListRemote: %v", err)
	}
	if len(first) != 1 || first[0].IP != "198.51.100.1" {
		t.Fatalf("first call mis-parsed: %+v", first)
	}

	// Mutate Redis behind the cache. If the second call hit Redis it
	// would see two peers; a cache hit returns the original one.
	setRemote(t, mr, "h", `[{"peerId":"a","ip":"198.51.100.1","port":6881},{"peerId":"b","ip":"198.51.100.2","port":6882}]`)

	second, err := s.ListRemote(ctx, "h")
	if err != nil {
		t.Fatalf("second ListRemote: %v", err)
	}
	if len(second) != 1 {
		t.Fatalf("second call should be a cache hit (len 1), got len %d — Redis was re-read", len(second))
	}
}

// TestListRemote_CacheMissIsCached confirms an absent key caches a nil
// result: even after the key later appears, a second call within the TTL
// still returns nil (the cached miss), proving the miss path is memoised
// (this is the hot non-federated-torrent case the cache exists for).
func TestListRemote_CacheMissIsCached(t *testing.T) {
	s, mr := newTestStore(t, 24*time.Hour)
	ctx := context.Background()

	got, err := s.ListRemote(ctx, "absent")
	if err != nil || got != nil {
		t.Fatalf("first call on absent key: got (%+v, %v), want (nil, nil)", got, err)
	}

	// Key appears after the miss was cached.
	setRemote(t, mr, "absent", `[{"peerId":"a","ip":"198.51.100.1","port":6881}]`)

	got2, err := s.ListRemote(ctx, "absent")
	if err != nil {
		t.Fatalf("second ListRemote: %v", err)
	}
	if got2 != nil {
		t.Fatalf("second call should return the cached nil miss, got %+v", got2)
	}
}

// TestListRemote_ExpiredCacheRefetches forces the cache entry's expiry
// into the past and confirms the next call re-reads Redis and picks up the
// updated value — the complement to the cache-hit test.
func TestListRemote_ExpiredCacheRefetches(t *testing.T) {
	s, mr := newTestStore(t, 24*time.Hour)
	ctx := context.Background()

	setRemote(t, mr, "h", `[{"peerId":"a","ip":"198.51.100.1","port":6881}]`)
	if _, err := s.ListRemote(ctx, "h"); err != nil {
		t.Fatalf("priming call: %v", err)
	}

	// Expire the cached entry by rewriting it with a past expiresAt.
	v, ok := s.remoteCache.Load("h")
	if !ok {
		t.Fatal("expected a cached entry after the priming call")
	}
	entry := v.(*remoteCacheEntry)
	s.remoteCache.Store("h", &remoteCacheEntry{
		peers:     entry.peers,
		expiresAt: time.Now().Add(-time.Second), // already expired
	})

	// Underlying key now has two peers; an expired cache must refetch.
	setRemote(t, mr, "h", `[{"peerId":"a","ip":"198.51.100.1","port":6881},{"peerId":"b","ip":"198.51.100.2","port":6882}]`)

	got, err := s.ListRemote(ctx, "h")
	if err != nil {
		t.Fatalf("post-expiry ListRemote: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expired cache should refetch (len 2), got len %d", len(got))
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
