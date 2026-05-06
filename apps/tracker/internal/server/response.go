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
// We always emit BEP-23 compact format. Non-compact (peer-dict) is rarely
// requested by modern clients and BEP 23 is universally supported, so
// honoring `compact=0` would just complicate the response path.
func buildAnnounceResponse(seeders, leechers int, peers []*peers.PeerData, _ bool, excludePeerID [20]byte, numWant int) []byte {
	enc := bencode.NewEncoder(256)
	enc.DictStart()

	// Keys MUST be in lexicographic order for strict clients.
	enc.String("complete")
	enc.Int(int64(seeders))

	enc.String("incomplete")
	enc.Int(int64(leechers))

	enc.String("interval")
	enc.Int(announceInterval)

	enc.String("min interval")
	enc.Int(minAnnounceInterval)

	enc.String("peers")
	enc.ByteString(buildCompactPeers(peers, excludePeerID, numWant))

	enc.End()
	return enc.Bytes()
}

// buildCompactPeers emits the BEP 23 compact peer list: 6 bytes per IPv4
// peer (4 bytes IP + 2 bytes BE port). Non-IPv4 peers are skipped.
func buildCompactPeers(peerList []*peers.PeerData, exclude [20]byte, numWant int) []byte {
	if numWant <= 0 {
		numWant = 50
	}
	excludeHex := hexBytes(exclude[:])
	out := make([]byte, 0, 6*len(peerList))
	for _, p := range peerList {
		if len(out)/6 >= numWant {
			break
		}
		if p.PeerID == excludeHex {
			continue
		}
		ip := net.ParseIP(p.IP)
		if ip == nil {
			continue
		}
		ip4 := ip.To4()
		if ip4 == nil {
			continue
		}
		out = append(out, ip4...)
		var port [2]byte
		binary.BigEndian.PutUint16(port[:], p.Port)
		out = append(out, port[:]...)
	}
	return out
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
