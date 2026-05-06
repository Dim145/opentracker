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
