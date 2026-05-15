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
// for 50 peers gets at most 50 total. Per BEP 7 it's spread *fairly*
// between IPv4 and IPv6 — each family gets at least `numWant/2` slots
// before the other can over-pick. A swarm with 45 IPv4 + 10 IPv6 used
// to fill the response with v4 and starve v6; now v6 gets its 25-slot
// share, falling back to v4 only if v6 runs out of candidates. The
// reverse symmetry holds. This matches BEP 7's intent that dual-stack
// clients see both families even when one is the swarm majority.
//
// The announcer's own `peer_id` is filtered out (BEP 3: a client
// doesn't need to be told about itself).
func splitCompactPeers(peerList []*peers.PeerData, exclude [20]byte, numWant int) (v4, v6 []byte) {
	if numWant <= 0 {
		numWant = 50
	}
	excludeHex := hexBytes(exclude[:])

	// First pass: partition. Cheap (one parse + classify per peer).
	v4peers := make([]*peers.PeerData, 0, len(peerList))
	v6peers := make([]*peers.PeerData, 0, len(peerList))
	for _, p := range peerList {
		if p.PeerID == excludeHex {
			continue
		}
		ip := net.ParseIP(p.IP)
		if ip == nil {
			continue
		}
		if ip.To4() != nil {
			v4peers = append(v4peers, p)
		} else if ip.To16() != nil {
			v6peers = append(v6peers, p)
		}
	}

	// Fair allocation. Each family gets at least its share; unused slack
	// rolls over to the other family.
	maxV4 := numWant - numWant/2 // ceil(numWant/2)
	maxV6 := numWant / 2         // floor(numWant/2)
	if len(v4peers) < maxV4 {
		maxV6 += maxV4 - len(v4peers)
	}
	if len(v6peers) < maxV6 {
		maxV4 += maxV6 - len(v6peers)
	}
	if len(v4peers) > maxV4 {
		v4peers = v4peers[:maxV4]
	}
	if len(v6peers) > maxV6 {
		v6peers = v6peers[:maxV6]
	}

	// Second pass: write the compact strings.
	v4 = make([]byte, 0, 6*len(v4peers))
	v6 = make([]byte, 0, 18*len(v6peers))
	var portBuf [2]byte
	for _, p := range v4peers {
		ip4 := net.ParseIP(p.IP).To4()
		v4 = append(v4, ip4...)
		binary.BigEndian.PutUint16(portBuf[:], p.Port)
		v4 = append(v4, portBuf[:]...)
	}
	for _, p := range v6peers {
		ip16 := net.ParseIP(p.IP).To16()
		v6 = append(v6, ip16...)
		binary.BigEndian.PutUint16(portBuf[:], p.Port)
		v6 = append(v6, portBuf[:]...)
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
