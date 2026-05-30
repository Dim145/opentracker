package udp

import (
	"encoding/binary"
	"net"

	"github.com/florianjs/trackarr/apps/tracker/internal/peers"
)

// EncodeAnnounceResponse writes a BEP 15 announce response: the 20-byte
// header followed by `n × 6` compact peer entries (4-byte IPv4 + 2-byte
// big-endian port). Returns the slice ready to send.
//
// Caller can pre-size `out` if it's reusing a packet buffer; we grow
// only when necessary so the hot path stays alloc-free for any
// num_want value the client requested.
//
// Filtering rules mirror the HTTP `buildCompactPeers`: skip the
// announcer's own peer_id (BEP 3 — they don't need a back-reference to
// themselves), drop non-IPv4 entries (BEP 7 v6 lives on a different
// action), and stop at numWant.
func EncodeAnnounceResponse(
	out []byte,
	transactionID uint32,
	interval int,
	leechers, seeders int,
	peerList []*peers.PeerData,
	excludePeerHex string,
	numWant int,
) []byte {
	if numWant <= 0 {
		numWant = 50
	}
	// Worst-case size: header + at most `numWant` peers (the write
	// loop below stops at numWant). Sizing to the FULL swarm wasted
	// allocation on large torrents (finding L6) — bound it by the
	// effective write budget.
	peerBudget := numWant
	if len(peerList) < peerBudget {
		peerBudget = len(peerList)
	}
	maxLen := announceRespHdr + 6*peerBudget
	if cap(out) < maxLen {
		out = make([]byte, maxLen)
	}
	out = out[:announceRespHdr]
	binary.BigEndian.PutUint32(out[0:4], ActionAnnounce)
	binary.BigEndian.PutUint32(out[4:8], transactionID)
	binary.BigEndian.PutUint32(out[8:12], uint32(interval))
	binary.BigEndian.PutUint32(out[12:16], uint32(leechers))
	binary.BigEndian.PutUint32(out[16:20], uint32(seeders))

	written := 0
	for _, p := range peerList {
		if written >= numWant {
			break
		}
		if p.PeerID == excludePeerHex {
			continue
		}
		ip := net.ParseIP(p.IP)
		if ip == nil {
			continue
		}
		v4 := ip.To4()
		if v4 == nil {
			continue
		}
		out = append(out, v4...)
		var portBuf [2]byte
		binary.BigEndian.PutUint16(portBuf[:], p.Port)
		out = append(out, portBuf[:]...)
		written++
	}
	return out
}

// ScrapeStat groups the three counts a UDP scrape entry must report.
// Identical shape to the HTTP version, but kept in this package to
// avoid pulling the entire `server` package as a transitive dep just
// for one struct.
type ScrapeStat struct {
	Seeders   int
	Completed int64
	Leechers  int
}

// EncodeScrapeResponse writes a BEP 15 scrape response: 8-byte header
// followed by 12 bytes per requested info_hash (seeders, completed,
// leechers — int32 each, big-endian). The caller must pass `stats` in
// the same order the client requested its hashes.
//
// We deliberately don't filter or reorder: BEP 15 requires the
// response to be index-aligned with the request's info_hash list, so
// drift would silently misattribute counts to the wrong hash on the
// client side.
func EncodeScrapeResponse(out []byte, transactionID uint32, stats []ScrapeStat) []byte {
	size := scrapeRespHdr + scrapeEntrySize*len(stats)
	if cap(out) < size {
		out = make([]byte, size)
	}
	out = out[:size]
	binary.BigEndian.PutUint32(out[0:4], ActionScrape)
	binary.BigEndian.PutUint32(out[4:8], transactionID)
	for i, s := range stats {
		off := scrapeRespHdr + scrapeEntrySize*i
		binary.BigEndian.PutUint32(out[off+0:off+4], uint32(s.Seeders))
		binary.BigEndian.PutUint32(out[off+4:off+8], uint32(s.Completed))
		binary.BigEndian.PutUint32(out[off+8:off+12], uint32(s.Leechers))
	}
	return out
}

// EncodeError writes a BEP 15 action=3 error response. The reason is
// ASCII text without a length prefix — the wire envelope is just:
//
//	action=3        (4B)
//	transaction_id  (4B)
//	message         (n bytes, no trailing NUL)
//
// We cap the message at 256 bytes so a runaway error string can't
// inflate a UDP datagram past the typical MTU.
func EncodeError(out []byte, transactionID uint32, reason string) []byte {
	if len(reason) > 256 {
		reason = reason[:256]
	}
	size := 8 + len(reason)
	if cap(out) < size {
		out = make([]byte, size)
	}
	out = out[:size]
	binary.BigEndian.PutUint32(out[0:4], ActionError)
	binary.BigEndian.PutUint32(out[4:8], transactionID)
	copy(out[8:], reason)
	return out
}
