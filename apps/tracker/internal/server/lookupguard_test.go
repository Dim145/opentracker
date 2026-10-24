package server

import (
	"strings"
	"testing"
	"time"
)

// A client that keeps announcing with a passkey nobody holds, or for a hash no
// torrent has, is answered from memory once it has used up its failures — the
// database is not its load generator.
func TestLookupGuard_BlocksAfterTheLimitForTheRestOfTheWindow(t *testing.T) {
	g := newLookupGuard()
	now := time.Unix(1_700_000_000, 0)
	for i := 0; i < maxLookupFailures-1; i++ {
		g.fail("203.0.113.7", now)
	}
	if g.blocked("203.0.113.7", now) {
		t.Fatal("bloqué avant d'avoir atteint la limite")
	}
	g.fail("203.0.113.7", now)
	if !g.blocked("203.0.113.7", now.Add(30*time.Second)) {
		t.Fatal("devait être bloqué pour le reste de la minute")
	}
	if g.blocked("203.0.113.8", now) {
		t.Fatal("une autre adresse ne doit pas payer pour la première")
	}
	if g.blocked("203.0.113.7", now.Add(61*time.Second)) {
		t.Fatal("la fenêtre suivante repart de zéro")
	}
}

// Every address of one IPv6 /64 counts as one client.
func TestLookupGuard_FoldsAnIPv6Slash64(t *testing.T) {
	g := newLookupGuard()
	now := time.Unix(1_700_000_000, 0)
	for i := 0; i < maxLookupFailures; i++ {
		g.fail("2001:db8:aa:bb::"+strings.Repeat("1", 1+i%4), now)
	}
	if !g.blocked("2001:db8:aa:bb:ffff::1", now) {
		t.Fatal("tourner dans son /64 ne doit pas échapper au compte")
	}
	if g.blocked("2001:db8:aa:bc::1", now) {
		t.Fatal("un autre /64 n'est pas concerné")
	}
}

func TestPlausiblePasskey(t *testing.T) {
	for _, ok := range []string{strings.Repeat("a", 40), strings.Repeat("F", 32), strings.Repeat("0", 64)} {
		if !plausiblePasskey(ok) {
			t.Fatalf("%q devait passer", ok)
		}
	}
	for _, bad := range []string{"", "short", strings.Repeat("a", 31), strings.Repeat("a", 65), strings.Repeat("g", 40), strings.Repeat("a", 39) + "'"} {
		if plausiblePasskey(bad) {
			t.Fatalf("%q devait être refusé", bad)
		}
	}
}
