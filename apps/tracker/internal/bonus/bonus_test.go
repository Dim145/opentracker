package bonus

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// ----------------------------------------------------------------------------
// Apply — arithmetic correctness and overflow safety
// ----------------------------------------------------------------------------

func TestApply_Identity(t *testing.T) {
	up, down := Identity.Apply(1024, 2048)
	if up != 1024 || down != 2048 {
		t.Fatalf("Identity.Apply: got (%d,%d), want (1024,2048)", up, down)
	}
}

func TestApply_Freeleech(t *testing.T) {
	// 200/100 = 2× upload, 0× download (classic freeleech: up doubled,
	// down free).
	m := Multipliers{Download: 0, Upload: 200}
	up, down := m.Apply(500, 1000)
	if up != 1000 {
		t.Fatalf("up: got %d, want 1000", up)
	}
	if down != 0 {
		t.Fatalf("down: got %d, want 0", down)
	}
}

// TestApply_NoOverflowAt1TiB ensures that with the per-announce
// delta cap (1 TiB = 2^40) and the maxMultiplier ceiling (100000 = 1000×),
// the int64 multiplication can never wrap. 2^40 × 100000 / 100 = 10^15
// ≪ 9.2 × 10^18 (int64 max).
func TestApply_NoOverflowAt1TiB(t *testing.T) {
	const oneTiB = int64(1) << 40 // 1 TiB
	m := Multipliers{Download: maxMultiplier, Upload: maxMultiplier}
	up, down := m.Apply(oneTiB, oneTiB)
	if up < 0 || down < 0 {
		t.Fatalf("overflow detected: up=%d down=%d", up, down)
	}
	want := oneTiB * int64(maxMultiplier) / 100
	if up != want {
		t.Fatalf("up: got %d, want %d", up, want)
	}
}

// ----------------------------------------------------------------------------
// validateSnapshot — defensive parsing guards
// ----------------------------------------------------------------------------

const nowMs = 1_750_000_000_000 // arbitrary "current time" for window tests

func TestValidate_HealthyWindow(t *testing.T) {
	raw := `{"id":"a","downloadMultiplier":50,"uploadMultiplier":200,"startsAtMs":1,"endsAtMs":9999999999999}`
	m := validateSnapshot(raw, nowMs)
	if m.Download != 50 || m.Upload != 200 {
		t.Fatalf("got %+v, want {Download:50 Upload:200}", m)
	}
}

func TestValidate_ExpiredWindow(t *testing.T) {
	// endsAtMs is in the past → fail open to identity.
	raw := `{"downloadMultiplier":50,"uploadMultiplier":200,"startsAtMs":1,"endsAtMs":1000}`
	if got := validateSnapshot(raw, nowMs); got != Identity {
		t.Fatalf("got %+v, want Identity (expired window)", got)
	}
}

func TestValidate_NotYetStarted(t *testing.T) {
	// startsAtMs is in the future → fail open to identity.
	raw := `{"downloadMultiplier":50,"uploadMultiplier":200,"startsAtMs":9999999999999,"endsAtMs":99999999999999}`
	if got := validateSnapshot(raw, nowMs); got != Identity {
		t.Fatalf("got %+v, want Identity (not yet started)", got)
	}
}

func TestValidate_NegativeMultiplier(t *testing.T) {
	raw := `{"downloadMultiplier":-1,"uploadMultiplier":200,"startsAtMs":1,"endsAtMs":9999999999999}`
	if got := validateSnapshot(raw, nowMs); got != Identity {
		t.Fatalf("got %+v, want Identity (negative multiplier)", got)
	}
}

// TestValidate_OverflowMultiplier exercises the new upper bound. A
// poisoned snapshot with `uploadMultiplier: 1000000` would, without
// the cap, blow past int64 in Apply() and credit users with negative
// bytes.
func TestValidate_OverflowMultiplier(t *testing.T) {
	raw := `{"downloadMultiplier":100,"uploadMultiplier":1000000,"startsAtMs":1,"endsAtMs":9999999999999}`
	if got := validateSnapshot(raw, nowMs); got != Identity {
		t.Fatalf("got %+v, want Identity (multiplier above max)", got)
	}
}

// Just-at-the-boundary: maxMultiplier itself is accepted.
func TestValidate_AtCeiling(t *testing.T) {
	raw := `{"downloadMultiplier":100,"uploadMultiplier":100000,"startsAtMs":1,"endsAtMs":9999999999999}`
	m := validateSnapshot(raw, nowMs)
	if m.Upload != maxMultiplier {
		t.Fatalf("got %+v, want Upload=%d", m, maxMultiplier)
	}
}

func TestValidate_MalformedJSON(t *testing.T) {
	if got := validateSnapshot("not json", nowMs); got != Identity {
		t.Fatalf("got %+v, want Identity (malformed JSON)", got)
	}
}

// ----------------------------------------------------------------------------
// Get — full flow with a miniredis backend
// ----------------------------------------------------------------------------

func newTestResolver(t *testing.T) (*Resolver, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	r := New(client, "ot:")
	r.SetTTL(50 * time.Millisecond) // fast cache turnaround for tests
	return r, mr
}

func writeSnapshot(t *testing.T, mr *miniredis.Miniredis, s snapshot) {
	t.Helper()
	raw, err := json.Marshal(s)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	mr.Set("ot:bonus:active", string(raw))
}

func TestGet_NoKey_ReturnsIdentity(t *testing.T) {
	r, _ := newTestResolver(t)
	got := r.Get(context.Background())
	if got != Identity {
		t.Fatalf("got %+v, want Identity", got)
	}
}

func TestGet_ValidSnapshot(t *testing.T) {
	r, mr := newTestResolver(t)
	nowMs := time.Now().UnixMilli()
	writeSnapshot(t, mr, snapshot{
		DownloadMultiplier: 50,
		UploadMultiplier:   200,
		StartsAtMs:         nowMs - 1000,
		EndsAtMs:           nowMs + 60_000,
	})
	got := r.Get(context.Background())
	if got.Download != 50 || got.Upload != 200 {
		t.Fatalf("got %+v, want {50, 200}", got)
	}
}

func TestGet_CachesResult(t *testing.T) {
	r, mr := newTestResolver(t)
	nowMs := time.Now().UnixMilli()
	writeSnapshot(t, mr, snapshot{
		DownloadMultiplier: 100,
		UploadMultiplier:   500,
		StartsAtMs:         nowMs - 1000,
		EndsAtMs:           nowMs + 60_000,
	})
	first := r.Get(context.Background())
	// Mutate Redis behind the cache; same call within TTL must
	// return the cached value.
	mr.Del("ot:bonus:active")
	second := r.Get(context.Background())
	if first != second {
		t.Fatalf("cache miss: first=%+v second=%+v", first, second)
	}
}

func TestGet_CacheExpires(t *testing.T) {
	r, mr := newTestResolver(t)
	r.SetTTL(20 * time.Millisecond)
	nowMs := time.Now().UnixMilli()
	writeSnapshot(t, mr, snapshot{
		DownloadMultiplier: 100,
		UploadMultiplier:   500,
		StartsAtMs:         nowMs - 1000,
		EndsAtMs:           nowMs + 60_000,
	})
	_ = r.Get(context.Background())
	time.Sleep(30 * time.Millisecond) // past TTL
	mr.Del("ot:bonus:active")
	got := r.Get(context.Background())
	if got != Identity {
		t.Fatalf("got %+v, want Identity after cache expiry", got)
	}
}

func TestGet_RejectsExpiredWindow(t *testing.T) {
	r, mr := newTestResolver(t)
	writeSnapshot(t, mr, snapshot{
		DownloadMultiplier: 50,
		UploadMultiplier:   200,
		StartsAtMs:         1,
		EndsAtMs:           1000, // ended long ago
	})
	got := r.Get(context.Background())
	if got != Identity {
		t.Fatalf("got %+v, want Identity (expired window)", got)
	}
}

func TestGet_RejectsMalformedJSON(t *testing.T) {
	r, mr := newTestResolver(t)
	mr.Set("ot:bonus:active", "garbage")
	got := r.Get(context.Background())
	if got != Identity {
		t.Fatalf("got %+v, want Identity (malformed)", got)
	}
}

func TestGet_RedisError_FailsOpen(t *testing.T) {
	r, mr := newTestResolver(t)
	// Simulate a Redis outage by closing the underlying mock.
	mr.Close()
	got := r.Get(context.Background())
	if got != Identity {
		t.Fatalf("got %+v, want Identity (Redis down → fail-open)", got)
	}
}
