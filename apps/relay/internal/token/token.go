// Package token verifies the short-lived bearer the API hands the browser.
//
// The relay never reads a session. It cannot: the session seal is Iron
// (`Fe26.2`), and re-implementing that here would be the first of the
// thousand-odd lines of security logic this service exists NOT to
// duplicate. Instead the API — which does have the session — mints a
// token, and the relay checks a signature.
//
// That is the whole trust boundary: a valid signature means "the API said
// this user may listen on their own channel", and nothing else. The relay
// makes no authorisation decision of its own, because it has no basis for
// one.
package token

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var (
	ErrMalformed = errors.New("token: malformed")
	ErrSignature = errors.New("token: bad signature")
	ErrExpired   = errors.New("token: expired")
)

// Claims is deliberately tiny. It carries no channel list: the relay
// derives the channel from the user id, because a member listens to their
// own channel and nothing else. A list would have to be reissued every
// time a conversation is opened.
type Claims struct {
	UserID string `json:"uid"`
	Expiry int64  `json:"exp"`
	// Whether this member may listen to the room. `omitempty` is what
	// keeps a token without room access byte-identical to what the format
	// produced before this field existed — the golden value in the tests
	// did not move when it was added.
	Room bool `json:"rm,omitempty"`
}

var enc = base64.RawURLEncoding

// Verify checks the signature and the clock, and returns the claims.
//
// Constant-time comparison, because a signature check that leaks timing is
// a signature check an attacker can walk one byte at a time.
func Verify(raw string, secret []byte, now time.Time) (*Claims, error) {
	payloadPart, sigPart, ok := strings.Cut(raw, ".")
	if !ok {
		return nil, ErrMalformed
	}

	payload, err := enc.DecodeString(payloadPart)
	if err != nil {
		return nil, ErrMalformed
	}
	sig, err := enc.DecodeString(sigPart)
	if err != nil {
		return nil, ErrMalformed
	}

	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(payloadPart))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, ErrSignature
	}

	var claims Claims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, ErrMalformed
	}
	if claims.UserID == "" {
		return nil, ErrMalformed
	}
	if now.Unix() >= claims.Expiry {
		return nil, ErrExpired
	}
	return &claims, nil
}

// Sign exists for the tests, and as the executable statement of the format
// the API has to produce. A format described only in prose drifts.
func Sign(claims Claims, secret []byte) string {
	payload, _ := json.Marshal(claims)
	encoded := enc.EncodeToString(payload)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(encoded))
	return encoded + "." + enc.EncodeToString(mac.Sum(nil))
}
