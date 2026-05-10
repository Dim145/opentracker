// Package udp implements the BEP 15 UDP tracker protocol on top of the
// wire-agnostic announce processor that lives in `internal/server`.
//
// The protocol is a two-step handshake:
//
//  1. Client sends `connect`; we issue a 64-bit `connection_id` derived
//     from the client's source IP and a wall-clock minute bucket.
//  2. Client echoes the `connection_id` back inside every subsequent
//     `announce` / `scrape` request. We re-derive the expected ids for
//     the current minute and the previous one and compare in constant
//     time.
//
// The minute bucket scheme is the same idea opentracker uses: it makes
// the issuance stateless (the server keeps no per-connection memory)
// while keeping ids short-lived enough that an off-path attacker who
// scraped one off the wire can't reuse it more than ~120 s later. BEP 15
// recommends "no more than 2 minutes" — we cover the current bucket plus
// the previous one, so the worst-case validity window is just under
// 2 × 60 s = 120 s.
//
// The HMAC key is the existing IPHashSecret. Reusing it avoids adding
// another required env var; it's already a per-deployment secret (the
// same one used to fingerprint client IPs) and leaking the connection
// ids — which are derived but not invertible — wouldn't reveal anything
// about it.
package udp

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"net"
	"time"
)

// ConnIDIssuer issues and validates BEP 15 `connection_id` values.
// Stateless: no per-id memory, just an HMAC closure over (ip, minute).
type ConnIDIssuer struct {
	secret []byte
	// now is injected for tests so we can pin the wall clock when
	// asserting issue/validate at minute boundaries. Production paths
	// always pass `time.Now`.
	now func() time.Time
}

// NewConnIDIssuer builds an issuer keyed on the deployment's IPHashSecret.
func NewConnIDIssuer(secret string) *ConnIDIssuer {
	return &ConnIDIssuer{
		secret: []byte(secret),
		now:    time.Now,
	}
}

// Issue generates the 8-byte connection_id the server should hand back
// in a `connect` response for the given source IP. The id is derived
// from (ip, current minute) so it cycles automatically and we never
// have to evict anything.
func (i *ConnIDIssuer) Issue(ip net.IP) uint64 {
	return i.derive(ip, i.now().UTC().Unix()/60)
}

// Validate reports whether `id` was issued by this server to `ip`
// within the last ~2 minutes. We accept the current minute and the
// previous one — any older and the announce should re-handshake.
//
// The check is constant-time so an attacker who spams candidate ids
// can't time-side-channel a partial match.
func (i *ConnIDIssuer) Validate(ip net.IP, id uint64) bool {
	now := i.now().UTC().Unix() / 60
	for _, m := range []int64{now, now - 1} {
		if hmac.Equal(uint64Bytes(i.derive(ip, m)), uint64Bytes(id)) {
			return true
		}
	}
	return false
}

// derive computes HMAC-SHA256(secret, ip || minute) and folds the 32-byte
// digest into 8 bytes by XORing the first 8 bytes with the next 8 — same
// idea as opentracker's "fold" trick. We never want the connection id to
// equal the BEP 15 magic protocol_id (0x41727101980), since the magic is
// the marker that distinguishes a connect from an announce; an issuer
// that ever generated the magic would reject a perfectly good announce
// downstream. The probability is 2^-64 in random space, but we explicitly
// guard against it on the (vanishingly unlikely) collision.
func (i *ConnIDIssuer) derive(ip net.IP, minute int64) uint64 {
	mac := hmac.New(sha256.New, i.secret)
	// IPv4 announces always carry a 16-byte representation through net.IP;
	// ToBytes normalises so the same address keyed via two different
	// in-memory layouts (4-byte vs 4-in-16) hashes the same way.
	mac.Write(ipBytes(ip))
	var minBuf [8]byte
	binary.BigEndian.PutUint64(minBuf[:], uint64(minute))
	mac.Write(minBuf[:])
	sum := mac.Sum(nil)
	id := binary.BigEndian.Uint64(sum[0:8]) ^ binary.BigEndian.Uint64(sum[8:16])
	if id == magicProtocolID {
		// 1:2^64 collision; flip a bit so the magic guard in Parse
		// downstream still works. Using XOR with a non-zero constant
		// keeps the function deterministic — the same input always
		// yields the same id, even on this near-impossible branch.
		id ^= 1
	}
	return id
}

func ipBytes(ip net.IP) []byte {
	if v4 := ip.To4(); v4 != nil {
		return v4
	}
	return ip.To16()
}

func uint64Bytes(v uint64) []byte {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], v)
	return b[:]
}
