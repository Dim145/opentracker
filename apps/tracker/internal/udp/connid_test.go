package udp

import (
	"net"
	"testing"
	"time"
)

func TestConnIDIssueValidate(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 10, 12, 0, 30, 0, time.UTC)
	issuer := &ConnIDIssuer{
		secret: []byte("test-secret"),
		now:    func() time.Time { return now },
	}
	ip := net.ParseIP("203.0.113.42")
	id := issuer.Issue(ip)

	if !issuer.Validate(ip, id) {
		t.Fatalf("freshly issued id should validate within the same minute")
	}
}

func TestConnIDValidatesPreviousMinute(t *testing.T) {
	t.Parallel()

	base := time.Date(2026, 5, 10, 12, 0, 30, 0, time.UTC)
	issuer := &ConnIDIssuer{
		secret: []byte("test-secret"),
		now:    func() time.Time { return base },
	}
	ip := net.ParseIP("203.0.113.42")
	id := issuer.Issue(ip)

	// Roll the clock forward into the next minute — the id was issued
	// in minute N, validation now happens in minute N+1; BEP 15 still
	// allows this.
	issuer.now = func() time.Time { return base.Add(75 * time.Second) }
	if !issuer.Validate(ip, id) {
		t.Fatalf("id from previous minute should still validate")
	}
}

func TestConnIDRejectsAfterTwoMinutes(t *testing.T) {
	t.Parallel()

	base := time.Date(2026, 5, 10, 12, 0, 30, 0, time.UTC)
	issuer := &ConnIDIssuer{
		secret: []byte("test-secret"),
		now:    func() time.Time { return base },
	}
	ip := net.ParseIP("203.0.113.42")
	id := issuer.Issue(ip)

	// Roll forward 3 minutes. Both buckets the validator checks
	// (current and current-1) are too new to match the issuance.
	issuer.now = func() time.Time { return base.Add(3 * time.Minute) }
	if issuer.Validate(ip, id) {
		t.Fatalf("id older than 2 minutes should be rejected")
	}
}

func TestConnIDRejectsForeignIP(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 10, 12, 0, 30, 0, time.UTC)
	issuer := &ConnIDIssuer{
		secret: []byte("test-secret"),
		now:    func() time.Time { return now },
	}
	idForA := issuer.Issue(net.ParseIP("203.0.113.42"))

	// Same id, different source IP. An attacker who scraped the id
	// off the wire shouldn't be able to replay it from a different
	// vantage point.
	if issuer.Validate(net.ParseIP("198.51.100.7"), idForA) {
		t.Fatalf("connection_id should be IP-bound")
	}
}

func TestConnIDIPv4InIPv6Stable(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 5, 10, 12, 0, 30, 0, time.UTC)
	issuer := &ConnIDIssuer{
		secret: []byte("test-secret"),
		now:    func() time.Time { return now },
	}
	v4 := net.IPv4(203, 0, 113, 42)
	v4mapped := v4.To16()

	id1 := issuer.Issue(v4)
	id2 := issuer.Issue(v4mapped)
	if id1 != id2 {
		t.Fatalf("4-byte and 4-in-16 representations of the same IP should yield the same id (got %x vs %x)", id1, id2)
	}
}

func TestConnIDNeverEqualsMagic(t *testing.T) {
	t.Parallel()

	// We can't easily force the HMAC to produce the magic value, but
	// the explicit guard means even if it did the result wouldn't equal
	// magicProtocolID. Spot-check the guard by feeding a synthetic
	// path through derive(): the tested invariant is that for any
	// (ip, minute) pair the derive() output != magicProtocolID.
	issuer := NewConnIDIssuer("any-secret")
	for i := 0; i < 1000; i++ {
		id := issuer.derive(net.IPv4(byte(i>>8), byte(i), 0, 1), int64(i))
		if id == magicProtocolID {
			t.Fatalf("connection_id collision with protocol magic on iteration %d", i)
		}
	}
}
