package announce

import (
	"net/url"
	"testing"
)

// validInfoHash returns a 20-byte info_hash as a query-string compatible string.
func validInfoHash() string {
	b := make([]byte, InfoHashLen)
	for i := range b {
		b[i] = byte(i + 1)
	}
	return string(b)
}

// validPeerID returns a 20-byte peer_id.
func validPeerID() string {
	b := make([]byte, PeerIDLen)
	for i := range b {
		b[i] = byte(i + 100)
	}
	return string(b)
}

func baseValid() url.Values {
	return url.Values{
		"info_hash":  {validInfoHash()},
		"peer_id":    {validPeerID()},
		"port":       {"6881"},
		"uploaded":   {"1024"},
		"downloaded": {"512"},
		"left":       {"0"},
		"passkey":    {"abcd1234"},
	}
}

func TestParse_Happy(t *testing.T) {
	r, err := Parse(baseValid())
	if err != nil {
		t.Fatalf("Parse() unexpected error: %v", err)
	}
	if r.Port != 6881 {
		t.Errorf("Port = %d, want 6881", r.Port)
	}
	if r.Uploaded != 1024 || r.Downloaded != 512 || r.Left != 0 {
		t.Errorf("uploaded/downloaded/left wrong: %d/%d/%d", r.Uploaded, r.Downloaded, r.Left)
	}
	if !r.IsSeeder() {
		t.Errorf("IsSeeder() should be true when left=0")
	}
	if !r.Compact {
		t.Errorf("Compact should default to true")
	}
	if r.NumWant != 50 {
		t.Errorf("NumWant default = %d, want 50", r.NumWant)
	}
	if r.Passkey != "abcd1234" {
		t.Errorf("Passkey = %q", r.Passkey)
	}
}

func TestParse_MissingFields(t *testing.T) {
	cases := map[string]struct {
		mut  func(url.Values)
		want error
	}{
		"info_hash missing": {func(q url.Values) { q.Del("info_hash") }, ErrMissingInfoHash},
		"peer_id missing":   {func(q url.Values) { q.Del("peer_id") }, ErrMissingPeerID},
		"port missing":      {func(q url.Values) { q.Del("port") }, ErrMissingPort},
		"port zero":         {func(q url.Values) { q.Set("port", "0") }, ErrInvalidPort},
		"port garbage":      {func(q url.Values) { q.Set("port", "abc") }, ErrInvalidPort},
		"info_hash short":   {func(q url.Values) { q.Set("info_hash", "tooshort") }, ErrInfoHashLen},
		"peer_id short":     {func(q url.Values) { q.Set("peer_id", "tooshort") }, ErrPeerIDLen},
		"passkey missing":   {func(q url.Values) { q.Del("passkey") }, ErrMissingPasskey},
	}
	for name, tt := range cases {
		t.Run(name, func(t *testing.T) {
			q := baseValid()
			tt.mut(q)
			_, err := Parse(q)
			if err != tt.want {
				t.Errorf("got %v, want %v", err, tt.want)
			}
		})
	}
}

func TestParse_Events(t *testing.T) {
	cases := map[string]Event{
		"":          EventNone,
		"started":   EventStarted,
		"stopped":   EventStopped,
		"completed": EventCompleted,
		"weirdvalue": EventNone,
	}
	for in, want := range cases {
		q := baseValid()
		if in != "" {
			q.Set("event", in)
		}
		r, err := Parse(q)
		if err != nil {
			t.Fatalf("Parse(event=%q): %v", in, err)
		}
		if r.Event != want {
			t.Errorf("event=%q: got %v, want %v", in, r.Event, want)
		}
	}
}

func TestParse_LeftDefaultsToOneWhenMissing(t *testing.T) {
	q := baseValid()
	q.Del("left")
	r, err := Parse(q)
	if err != nil {
		t.Fatal(err)
	}
	if r.Left != 1 {
		t.Errorf("Left = %d, want 1 (default for missing)", r.Left)
	}
}

func TestParse_NumWantClamped(t *testing.T) {
	q := baseValid()
	q.Set("numwant", "5000")
	r, err := Parse(q)
	if err != nil {
		t.Fatal(err)
	}
	if r.NumWant != 100 {
		t.Errorf("NumWant = %d, want 100 (clamped)", r.NumWant)
	}
}

func TestEvent_String(t *testing.T) {
	cases := map[Event]string{
		EventStarted:   "started",
		EventStopped:   "stopped",
		EventCompleted: "completed",
		EventNone:      "update",
	}
	for ev, want := range cases {
		if got := ev.String(); got != want {
			t.Errorf("%v.String() = %q, want %q", ev, got, want)
		}
	}
}

func TestParse_UnknownEvent_RecordedOnRequest(t *testing.T) {
	q := baseValid()
	q.Set("event", "paused")
	r, err := Parse(q)
	if err != nil {
		t.Fatal(err)
	}
	if r.Event != EventNone {
		t.Errorf("Event: got %v, want EventNone for unknown token", r.Event)
	}
	if r.UnknownEventRaw != "paused" {
		t.Errorf("UnknownEventRaw: got %q, want %q", r.UnknownEventRaw, "paused")
	}
}

func TestParse_KnownEventDoesNotSetUnknownEventRaw(t *testing.T) {
	q := baseValid()
	q.Set("event", "started")
	r, err := Parse(q)
	if err != nil {
		t.Fatal(err)
	}
	if r.UnknownEventRaw != "" {
		t.Errorf("UnknownEventRaw should be empty for known event, got %q", r.UnknownEventRaw)
	}
}

func TestParse_NegativeNumWantIgnored(t *testing.T) {
	q := baseValid()
	q.Set("numwant", "-5")
	r, err := Parse(q)
	if err != nil {
		t.Fatal(err)
	}
	// Negative is rejected — default (50) survives.
	if r.NumWant != 50 {
		t.Errorf("NumWant: got %d, want 50 (default kept on negative)", r.NumWant)
	}
}

func TestParse_InvalidPort_Rejected(t *testing.T) {
	for _, p := range []string{"0", "not-a-port", "99999999"} {
		q := baseValid()
		q.Set("port", p)
		if _, err := Parse(q); err == nil {
			t.Errorf("Parse should reject port=%q", p)
		}
	}
}

func TestParse_MissingInfoHash(t *testing.T) {
	q := baseValid()
	q.Del("info_hash")
	if _, err := Parse(q); err == nil {
		t.Fatal("expected error for missing info_hash")
	}
}

func TestParse_WrongInfoHashLen(t *testing.T) {
	q := baseValid()
	q.Set("info_hash", "tooshort")
	if _, err := Parse(q); err == nil {
		t.Fatal("expected error for short info_hash")
	}
}

func TestParse_WrongPeerIDLen(t *testing.T) {
	q := baseValid()
	q.Set("peer_id", "short")
	if _, err := Parse(q); err == nil {
		t.Fatal("expected error for short peer_id")
	}
}

func TestParse_PasskeyExtracted(t *testing.T) {
	q := baseValid()
	q.Set("passkey", "deadbeef")
	r, err := Parse(q)
	if err != nil {
		t.Fatal(err)
	}
	if r.Passkey != "deadbeef" {
		t.Errorf("Passkey: got %q, want %q", r.Passkey, "deadbeef")
	}
}

func TestParse_MissingPasskey_Rejected(t *testing.T) {
	q := baseValid()
	q.Del("passkey")
	if _, err := Parse(q); err == nil {
		t.Fatal("expected ErrMissingPasskey")
	}
}

func TestParse_InvalidUploaded_ZeroFallback(t *testing.T) {
	q := baseValid()
	q.Set("uploaded", "not-a-number")
	r, err := Parse(q)
	if err != nil {
		t.Fatal(err)
	}
	// parseInt64 returns (0, false) on garbage → Uploaded stays 0.
	if r.Uploaded != 0 {
		t.Errorf("Uploaded: got %d, want 0", r.Uploaded)
	}
}

func TestParse_CompactZero(t *testing.T) {
	q := baseValid()
	q.Set("compact", "0")
	r, err := Parse(q)
	if err != nil {
		t.Fatal(err)
	}
	if r.Compact {
		t.Errorf("Compact: got true, want false when compact=0")
	}
}

func TestRequest_IsSeederTrueWhenLeftZero(t *testing.T) {
	q := baseValid()
	q.Set("left", "0")
	r, err := Parse(q)
	if err != nil {
		t.Fatal(err)
	}
	if !r.IsSeeder() {
		t.Error("IsSeeder() should be true when left=0")
	}
}
