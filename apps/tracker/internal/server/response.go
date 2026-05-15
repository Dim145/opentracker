package server

import (
	"encoding/binary"
	"net"

	"github.com/florianjs/trackarr/apps/tracker/internal/bencode"
	"github.com/florianjs/trackarr/apps/tracker/internal/peers"
)

const (
	// announceInterval is how often the client should re-announce (seconds).
	announceInterval = 1800
	// minAnnounceInterval is the minimum gap between announces; clients
	// announcing more frequently MAY be ignored.
	minAnnounceInterval = 900
)

// buildAnnounceResponse encodes the bencode dict the spec expects.
//
// We always emit BEP-23 compact format for the IPv4 `peers` list, and BEP-7
// compact format for the optional `peers6` IPv6 list. Non-compact (peer-dict)
// is rarely requested by modern clients and these two compact variants are
// universally supported, so honouring `compact=0` would just complicate the
// response path.
//
// Without BEP-7 support, every peer behind an IPv6-native ISP (or going
// through an IPv6-capable proxy like Cloudflare) would silently drop out of
// the peer list — the `To4()` filter in `splitCompactPeers` excludes them
// and the requesting client ends up with an empty `peers` string, which is
// indistinguishable from a dead swarm.
func buildAnnounceResponse(seeders, leechers int, peers []*peers.PeerData, _ bool, excludePeerID [20]byte, numWant int) []byte {
	v4, v6 := splitCompactPeers(peers, excludePeerID, numWant)

	enc := bencode.NewEncoder(256 + len(v4) + len(v6))
	enc.DictStart()

	// Keys MUST be in lexicographic byte order for strict clients.
	enc.String("complete")
	enc.Int(int64(seeders))

	enc.String("incomplete")
	enc.Int(int64(leechers))

	enc.String("interval")
	enc.Int(announceInterval)

	enc.String("min interval")
	enc.Int(minAnnounceInterval)

	enc.String("peers")
	enc.ByteString(v4)

	// BEP 7 — only emitted when we actually have IPv6 peers to offer.
	// Older clients that don't speak BEP 7 silently ignore unknown
	// keys, so the presence of `peers6` is never harmful; we keep the
	// dict tight for IPv4-only swarms to avoid the extra few bytes.
	if len(v6) > 0 {
		enc.String("peers6")
		enc.ByteString(v6)
	}

	enc.End()
	return enc.Bytes()
}

// splitCompactPeers walks the swarm once and returns two compact peer
// strings ready for bencoding:
//
//   - `v4`: 6-byte entries (4-byte IPv4 + 2-byte BE port).
//   - `v6`: 18-byte entries (16-byte IPv6 + 2-byte BE port).
//
// The numWant cap is **shared** across the two slices: a client asking
// for 50 peers gets at most 50 total, in whatever IPv4/IPv6 mix the
// swarm happens to surface first. This matches the BEP 7 intent — the
// cap is a hint about how many peers the client wants to try, not an
// invitation to receive 2× that.
//
// The announcer's own `peer_id` is filtered out (BEP 3: a client
// doesn't need to be told about itself).
func splitCompactPeers(peerList []*peers.PeerData, exclude [20]byte, numWant int) (v4, v6 []byte) {
	if numWant <= 0 {
		numWant = 50
	}
	excludeHex := hexBytes(exclude[:])
	v4 = make([]byte, 0, 6*len(peerList))
	v6 = make([]byte, 0, 18*len(peerList))
	count := 0
	for _, p := range peerList {
		if count >= numWant {
			break
		}
		if p.PeerID == excludeHex {
			continue
		}
		ip := net.ParseIP(p.IP)
		if ip == nil {
			continue
		}
		var portBuf [2]byte
		binary.BigEndian.PutUint16(portBuf[:], p.Port)
		if ip4 := ip.To4(); ip4 != nil {
			v4 = append(v4, ip4...)
			v4 = append(v4, portBuf[:]...)
			count++
			continue
		}
		if ip16 := ip.To16(); ip16 != nil {
			v6 = append(v6, ip16...)
			v6 = append(v6, portBuf[:]...)
			count++
		}
	}
	return v4, v6
}

// scrapeResponse builds the bencode dict expected by /scrape (BEP 48).
//
//	d
//	  5:files
//	    d
//	      <20-byte info_hash>
//	        d
//	          8:complete    i<seeders>e
//	          10:downloaded i<completed>e
//	          10:incomplete i<leechers>e
//	        e
//	      ...
//	    e
//	e
func scrapeResponse(stats []ScrapeStat) []byte {
	enc := bencode.NewEncoder(64 + 64*len(stats))
	enc.DictStart()
	enc.String("files")
	enc.DictStart()
	for _, s := range stats {
		enc.ByteString(s.InfoHashRaw[:])
		enc.DictStart()
		enc.String("complete")
		enc.Int(int64(s.Seeders))
		enc.String("downloaded")
		enc.Int(s.Completed)
		enc.String("incomplete")
		enc.Int(int64(s.Leechers))
		enc.End()
	}
	enc.End()
	enc.End()
	return enc.Bytes()
}

// ScrapeStat groups the three counts a scrape entry must report.
type ScrapeStat struct {
	InfoHashRaw [20]byte
	Seeders     int
	Leechers    int
	Completed   int64
}

// hexBytes encodes a 20-byte raw value as a 40-char lowercase hex string.
func hexBytes(b []byte) string {
	const hexdigits = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, v := range b {
		out[i*2] = hexdigits[v>>4]
		out[i*2+1] = hexdigits[v&0x0f]
	}
	return string(out)
}
