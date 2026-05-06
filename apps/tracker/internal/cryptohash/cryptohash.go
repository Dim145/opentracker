// Package cryptohash hashes peer IPs the same way the Node tracker did:
// SHA-256 with a per-day salt prefix, truncated to 16 hex characters.
//
// The output must be byte-for-byte identical to the api's hashIP() so that
// peer-IP hashes recorded by the tracker remain comparable to anything the
// api logs.
package cryptohash

import (
	"crypto/sha256"
	"encoding/hex"
	"time"
)

// dailyDate returns today's UTC date in YYYY-MM-DD format. Hoisted into a
// var so tests can stub it.
var dailyDate = func() string {
	return time.Now().UTC().Format("2006-01-02")
}

// HashIP returns the first 16 hex chars of SHA-256(secret:date:ip).
// `secret` should be the IP_HASH_SECRET environment variable.
func HashIP(ip, secret string) string {
	h := sha256.New()
	h.Write([]byte(secret))
	h.Write([]byte{':'})
	h.Write([]byte(dailyDate()))
	h.Write([]byte{':'})
	h.Write([]byte(ip))
	full := hex.EncodeToString(h.Sum(nil))
	return full[:16]
}
