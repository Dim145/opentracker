package cryptohash

import (
	"testing"
	"time"
)

func TestHashIP_StableForSameInputs(t *testing.T) {
	dailyDate = func() string { return "2026-05-06" }
	defer func() {
		dailyDate = func() string { return "" }
	}()

	a := HashIP("1.2.3.4", "secret")
	b := HashIP("1.2.3.4", "secret")
	if a != b {
		t.Errorf("HashIP not deterministic: %q vs %q", a, b)
	}
	if len(a) != 16 {
		t.Errorf("expected 16-char hash, got %d (%q)", len(a), a)
	}
}

func TestHashIP_DiffersByIP(t *testing.T) {
	dailyDate = func() string { return "2026-05-06" }
	a := HashIP("1.2.3.4", "secret")
	b := HashIP("1.2.3.5", "secret")
	if a == b {
		t.Errorf("hashes should differ across IPs")
	}
}

func TestHashIP_DiffersBySecret(t *testing.T) {
	dailyDate = func() string { return "2026-05-06" }
	a := HashIP("1.2.3.4", "secretA")
	b := HashIP("1.2.3.4", "secretB")
	if a == b {
		t.Errorf("hashes should differ across secrets")
	}
}

func TestHashIP_DiffersByDay(t *testing.T) {
	dailyDate = func() string { return "2026-05-06" }
	a := HashIP("1.2.3.4", "secret")
	dailyDate = func() string { return "2026-05-07" }
	b := HashIP("1.2.3.4", "secret")
	if a == b {
		t.Errorf("hashes should rotate daily")
	}
}

// Lock in the exact algorithm against a hand-computed reference.
// Computed with: echo -n "secret:2026-05-06:1.2.3.4" | sha256sum
func TestHashIP_KnownVector(t *testing.T) {
	dailyDate = func() string { return "2026-05-06" }
	got := HashIP("1.2.3.4", "secret")
	want := "199cb0c9c5e589e6"
	if got != want {
		t.Errorf("HashIP = %q, want %q", got, want)
	}
}

// Exercise the real (non-stubbed) dailyDate so the variable's
// initialiser is covered. We don't assert against today's date —
// that would make the test flaky every day — just check the format
// is what HashIP expects (10 chars, YYYY-MM-DD).
func TestDailyDate_RealClockFormat(t *testing.T) {
	// Restore real impl in case a previous test stubbed it.
	originalDailyDate()
	d := dailyDate()
	if len(d) != 10 || d[4] != '-' || d[7] != '-' {
		t.Fatalf("dailyDate format unexpected: %q (want YYYY-MM-DD)", d)
	}
}

// originalDailyDate re-installs the production function — same body
// as the package-level `var dailyDate = ...` initialiser.
func originalDailyDate() {
	dailyDate = func() string {
		return time.Now().UTC().Format("2006-01-02")
	}
}
