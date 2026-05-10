package udp

import (
	"encoding/binary"
	"errors"
	"strings"

	"github.com/florianjs/trackarr/apps/tracker/internal/announce"
)

// magicProtocolID is the constant used to distinguish a `connect`
// request from a stale or stray packet. BEP 15 hard-codes it and
// every conforming client sends it as the first 8 bytes of step 1.
const magicProtocolID uint64 = 0x41727101980

// Action codes, BEP 15 §3 ("Actions").
const (
	ActionConnect  uint32 = 0
	ActionAnnounce uint32 = 1
	ActionScrape   uint32 = 2
	ActionError    uint32 = 3
)

// Wire-format sizes. Constants rather than magic numbers so the encoder
// and the parser can cross-reference each other.
const (
	connectReqSize    = 16
	connectRespSize   = 16
	announceReqMinLen = 98
	announceRespHdr   = 20 // action + tx + interval + leechers + seeders
	scrapeReqMinLen   = 16 // header before the first info_hash
	scrapeRespHdr     = 8  // action + tx
	scrapeEntrySize   = 12 // seeders + completed + leechers
	maxScrapeHashes   = 74 // BEP 15 cap; 16 + 74*20 ≈ 1496 < 1500 MTU
	infoHashSize      = announce.InfoHashLen
	peerIDSize        = announce.PeerIDLen
)

// BEP 15 announce event codes.
const (
	udpEventNone      uint32 = 0
	udpEventCompleted uint32 = 1
	udpEventStarted   uint32 = 2
	udpEventStopped   uint32 = 3
)

// BEP 41 option types. The URL data option carries the path/query
// segment from the tracker URL (everything after `host:port`), which
// is how a client smuggles a passkey through the otherwise rigid
// 98-byte announce.
const (
	optEnd     byte = 0
	optNop     byte = 1
	optURLData byte = 2
)

// Parsing errors. We never echo these to the client verbatim — UDP
// errors are short ASCII strings and we keep them tracker-vague — but
// the constants make the code testable.
var (
	errPacketTooShort      = errors.New("packet too short")
	errBadMagic            = errors.New("invalid protocol_id")
	errInvalidConnectionID = errors.New("invalid connection_id")
	errMissingPasskey      = errors.New("missing passkey")
	errMalformedOptions    = errors.New("malformed options")
)

// ConnectRequest is the parsed step-1 packet. The transaction_id has
// to be echoed back so the client can correlate the response with its
// in-flight request.
type ConnectRequest struct {
	TransactionID uint32
}

// ParseConnect decodes a 16-byte connect request. Returns the
// transaction_id on success; rejects packets whose magic byte sequence
// doesn't match BEP 15.
func ParseConnect(data []byte) (*ConnectRequest, error) {
	if len(data) < connectReqSize {
		return nil, errPacketTooShort
	}
	if binary.BigEndian.Uint64(data[0:8]) != magicProtocolID {
		return nil, errBadMagic
	}
	if binary.BigEndian.Uint32(data[8:12]) != ActionConnect {
		return nil, errBadMagic
	}
	return &ConnectRequest{
		TransactionID: binary.BigEndian.Uint32(data[12:16]),
	}, nil
}

// EncodeConnectResponse writes the 16-byte response into `out` and
// returns the slice. Caller pre-allocates `out`; we never own buffers
// in this package so the udp.Server can reuse a single per-conn pool.
func EncodeConnectResponse(out []byte, transactionID uint32, connectionID uint64) []byte {
	if cap(out) < connectRespSize {
		out = make([]byte, connectRespSize)
	}
	out = out[:connectRespSize]
	binary.BigEndian.PutUint32(out[0:4], ActionConnect)
	binary.BigEndian.PutUint32(out[4:8], transactionID)
	binary.BigEndian.PutUint64(out[8:16], connectionID)
	return out
}

// AnnounceRequestUDP is the wire-form of a UDP announce: connection id
// + raw fields + the optional BEP 41 URL data trailer (where we look
// for the passkey).
type AnnounceRequestUDP struct {
	ConnectionID  uint64
	TransactionID uint32
	InfoHash      [infoHashSize]byte
	PeerID        [peerIDSize]byte
	Downloaded    int64
	Left          int64
	Uploaded      int64
	Event         uint32
	IPv4          uint32 // network byte order; 0 means "use source addr"
	Key           uint32
	NumWant       int32 // signed; -1 = default
	Port          uint16
	URLData       []byte // raw BEP 41 URL data option, may be nil
}

// ParseAnnounce decodes a 98+-byte announce request, including any
// BEP 41 trailer. The returned struct points back into `data` for
// URLData, so callers must copy the slice if they keep it past the
// recv buffer's lifetime.
//
// We accept any packet ≥ 98 bytes; everything past byte 98 is treated
// as the BEP 41 options list.
func ParseAnnounce(data []byte) (*AnnounceRequestUDP, error) {
	if len(data) < announceReqMinLen {
		return nil, errPacketTooShort
	}
	r := &AnnounceRequestUDP{
		ConnectionID:  binary.BigEndian.Uint64(data[0:8]),
		TransactionID: binary.BigEndian.Uint32(data[12:16]),
		Downloaded:    int64(binary.BigEndian.Uint64(data[56:64])),
		Left:          int64(binary.BigEndian.Uint64(data[64:72])),
		Uploaded:      int64(binary.BigEndian.Uint64(data[72:80])),
		Event:         binary.BigEndian.Uint32(data[80:84]),
		IPv4:          binary.BigEndian.Uint32(data[84:88]),
		Key:           binary.BigEndian.Uint32(data[88:92]),
		NumWant:       int32(binary.BigEndian.Uint32(data[92:96])),
		Port:          binary.BigEndian.Uint16(data[96:98]),
	}
	// action sanity — caller already routes by action, but if the
	// router was bypassed we'd rather hard-fail than silently feed
	// bogus bytes into the announce business logic.
	if action := binary.BigEndian.Uint32(data[8:12]); action != ActionAnnounce {
		return nil, errBadMagic
	}
	copy(r.InfoHash[:], data[16:36])
	copy(r.PeerID[:], data[36:56])

	if len(data) > announceReqMinLen {
		urlData, err := parseOptionsURLData(data[announceReqMinLen:])
		if err != nil {
			return nil, err
		}
		r.URLData = urlData
	}
	return r, nil
}

// parseOptionsURLData walks the BEP 41 options trailer and concatenates
// every URL_DATA option it finds. Most clients only emit one, but the
// spec explicitly allows fragmentation so the data may straddle several
// option records — we glue them together.
//
//	type     (1B)  0=End, 1=Nop, 2=URLData
//	length   (1B)  only present for URLData (and any future TLV)
//	data     (length B)
//
// EndOfOptions short-circuits the walk; an unknown type is treated as
// EndOfOptions to stay forward-compatible with future BEPs.
func parseOptionsURLData(opts []byte) ([]byte, error) {
	var out []byte
	for i := 0; i < len(opts); {
		t := opts[i]
		i++
		switch t {
		case optEnd:
			return out, nil
		case optNop:
			continue
		case optURLData:
			if i >= len(opts) {
				return nil, errMalformedOptions
			}
			n := int(opts[i])
			i++
			if i+n > len(opts) {
				return nil, errMalformedOptions
			}
			out = append(out, opts[i:i+n]...)
			i += n
		default:
			// Unknown TLV — treat as end-of-options per BEP 41's
			// forward-compatibility rule rather than rejecting the
			// whole announce.
			return out, nil
		}
	}
	return out, nil
}

// ToAnnounceRequest converts the UDP wire form into the wire-agnostic
// `announce.Request` consumed by `server.ProcessAnnounce`. Returns
// `errMissingPasskey` when the BEP 41 URL_DATA trailer is missing or
// doesn't contain a passkey field — without one the announce can't be
// authorised against a user.
//
// The passkey discovery rule mirrors what a typical libtorrent client
// emits when it sees `udp://host:6969/announce/PASSKEY` or
// `udp://host:6969/announce?passkey=PASSKEY`:
//   - Path style: trailing path segment (last `/`-delimited token)
//   - Query style: `passkey=…` value, anywhere in `?` query string
func (r *AnnounceRequestUDP) ToAnnounceRequest() (*announce.Request, error) {
	passkey := extractPasskey(r.URLData)
	if passkey == "" {
		return nil, errMissingPasskey
	}
	out := &announce.Request{
		InfoHash:   r.InfoHash,
		PeerID:     r.PeerID,
		Port:       r.Port,
		Uploaded:   nonNeg(r.Uploaded),
		Downloaded: nonNeg(r.Downloaded),
		Left:       nonNeg(r.Left),
		Event:      mapEvent(r.Event),
		Compact:    true, // UDP responses are always compact
		NumWant:    50,
		Passkey:    passkey,
	}
	// `numwant=-1` is BEP 15 shorthand for "the tracker decides";
	// otherwise honour what the client asked for, capped to the same
	// 100-peer ceiling the HTTP path uses (see announce.Parse).
	if r.NumWant >= 0 {
		out.NumWant = int(r.NumWant)
		if out.NumWant > 100 {
			out.NumWant = 100
		}
	}
	return out, nil
}

func nonNeg(v int64) int64 {
	if v < 0 {
		return 0
	}
	return v
}

func mapEvent(e uint32) announce.Event {
	switch e {
	case udpEventCompleted:
		return announce.EventCompleted
	case udpEventStarted:
		return announce.EventStarted
	case udpEventStopped:
		return announce.EventStopped
	default:
		return announce.EventNone
	}
}

// extractPasskey looks for a 32-character hex passkey in the BEP 41
// URL_DATA blob. We accept two shapes since libtorrent / qBittorrent /
// Transmission emit one or the other depending on how the tracker
// URL was written:
//
//   - Query: `…?passkey=ABCDEF…012345…` (or `&passkey=…` further along)
//   - Path:  `/announce/ABCDEF…012345…` — we take the last path segment
//
// Returning the empty string signals "no passkey present" and the
// caller responds with the standard "Passkey required" error.
func extractPasskey(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	s := string(data)

	// Query style takes precedence — if the URL has both, it almost
	// certainly was meant to be `?passkey=…` and the path before that
	// is just `/announce`.
	if q := strings.Index(s, "?"); q >= 0 {
		query := s[q+1:]
		for _, kv := range strings.Split(query, "&") {
			if eq := strings.IndexByte(kv, '='); eq > 0 {
				if kv[:eq] == "passkey" {
					return kv[eq+1:]
				}
			}
		}
	}
	// Path style — pluck the final segment. We deliberately accept any
	// non-empty trailing token rather than enforcing 32-char hex here:
	// the announce business logic already rejects unknown passkeys via
	// `pgx.ErrNoRows`, and a stricter check would just complicate
	// failure messages without adding security.
	path := s
	if q := strings.Index(s, "?"); q >= 0 {
		path = s[:q]
	}
	if i := strings.LastIndexByte(path, '/'); i >= 0 && i+1 < len(path) {
		seg := path[i+1:]
		// Reject the literal "announce" / "scrape" — those are the
		// route tokens, not a passkey. The `udp://host/announce` URL
		// (no passkey) shouldn't accidentally pass auth.
		if seg != "announce" && seg != "scrape" && seg != "" {
			return seg
		}
	}
	return ""
}
