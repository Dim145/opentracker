package token

import (
	"strings"
	"testing"
	"time"
)

// The token format is a contract between two languages: the API mints it in
// TypeScript, this package verifies it in Go. A format described only in
// prose drifts, so `Sign` here is the executable statement of it and
// `TestGoldenFromTypeScript` pins a value the API side must reproduce.

var secret = []byte("0123456789abcdef0123456789abcdef")

func TestRoundTrip(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	raw := Sign(Claims{UserID: "u-1", Expiry: now.Add(time.Minute).Unix()}, secret)

	claims, err := Verify(raw, secret, now)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.UserID != "u-1" {
		t.Fatalf("user id: %q", claims.UserID)
	}
}

func TestRejects(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	valid := Sign(Claims{UserID: "u-1", Expiry: now.Add(time.Minute).Unix()}, secret)

	cases := []struct {
		name string
		raw  string
		key  []byte
		at   time.Time
		want error
	}{
		{"another key", valid, []byte("ffffffffffffffffffffffffffffffff"), now, ErrSignature},
		{"expired", Sign(Claims{UserID: "u-1", Expiry: now.Unix()}, secret), secret, now, ErrExpired},
		{"no signature", strings.Split(valid, ".")[0], secret, now, ErrMalformed},
		{"empty", "", secret, now, ErrMalformed},
		{"no user", Sign(Claims{Expiry: now.Add(time.Minute).Unix()}, secret), secret, now, ErrMalformed},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Verify(tc.raw, tc.key, tc.at); err != tc.want {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}

func TestTamperedPayloadFailsSignature(t *testing.T) {
	// Swapping the payload for another user's must not survive: the whole
	// trust boundary is that this signature came from the API.
	now := time.Unix(1_700_000_000, 0)
	mine := Sign(Claims{UserID: "u-1", Expiry: now.Add(time.Minute).Unix()}, secret)
	theirs := Sign(Claims{UserID: "u-2", Expiry: now.Add(time.Minute).Unix()}, secret)

	forged := strings.Split(theirs, ".")[0] + "." + strings.Split(mine, ".")[1]
	if _, err := Verify(forged, secret, now); err != ErrSignature {
		t.Fatalf("a swapped payload verified: %v", err)
	}
}

// TestGoldenFromTypeScript pins the exact bytes. If the API's signing ever
// drifts — a different field order, a different base64 alphabet, padding —
// this fails here rather than as an unexplained 401 in production.
func TestGoldenFromTypeScript(t *testing.T) {
	const golden = "eyJ1aWQiOiJ1LTEiLCJleHAiOjE3MDAwMDAwNjB9.Gg9HRcJiJgSkA0u9UxTMvTcRlqxf8nPflZL_bvBE0Bw"
	now := time.Unix(1_700_000_000, 0)

	claims, err := Verify(golden, secret, now)
	if err != nil {
		t.Fatalf("the golden token no longer verifies: %v", err)
	}
	if claims.UserID != "u-1" || claims.Expiry != 1_700_000_060 {
		t.Fatalf("claims drifted: %+v", claims)
	}
	if got := Sign(Claims{UserID: "u-1", Expiry: 1_700_000_060}, secret); got != golden {
		t.Fatalf("Sign no longer produces the golden token:\n got %s\nwant %s", got, golden)
	}
}

// TestRoomClaimDoesNotMoveTheFormat is the reason `rm` is `omitempty`.
//
// Adding a field to a format two languages agree on is exactly where
// drift starts. Omitting it when false means a token without room access
// is byte-identical to what this produced before the field existed — so
// the golden above still holds, and only a room token carries the extra
// bytes.
func TestRoomClaimDoesNotMoveTheFormat(t *testing.T) {
	plain := Sign(Claims{UserID: "u-1", Expiry: 1_700_000_060}, secret)
	explicitlyFalse := Sign(Claims{UserID: "u-1", Expiry: 1_700_000_060, Room: false}, secret)
	if plain != explicitlyFalse {
		t.Fatalf("a false room claim changed the bytes:\n %s\n %s", plain, explicitlyFalse)
	}

	withRoom := Sign(Claims{UserID: "u-1", Expiry: 1_700_000_060, Room: true}, secret)
	if withRoom == plain {
		t.Fatal("a true room claim produced the same token as no claim")
	}

	claims, err := Verify(withRoom, secret, time.Unix(1_700_000_000, 0))
	if err != nil || !claims.Room {
		t.Fatalf("room claim did not survive the round trip: %v %+v", err, claims)
	}
	// And it cannot be granted by editing the token: the signature covers it.
	forged := strings.Split(withRoom, ".")[0] + "." + strings.Split(plain, ".")[1]
	if _, err := Verify(forged, secret, time.Unix(1_700_000_000, 0)); err != ErrSignature {
		t.Fatalf("room access was forgeable: %v", err)
	}
}
