// Package announce parses BitTorrent tracker announce/scrape requests.
package announce

import (
	"errors"
	"net/url"
	"strconv"
)

const (
	// InfoHashLen is the canonical length of an info_hash in raw bytes.
	InfoHashLen = 20
	// PeerIDLen is the canonical length of a peer_id in raw bytes.
	PeerIDLen = 20
)

// Event is the optional `event` query parameter from BEP 3.
type Event uint8

const (
	EventNone Event = iota
	EventStarted
	EventStopped
	EventCompleted
)

// String returns a stable lowercase event name for logging/storage.
func (e Event) String() string {
	switch e {
	case EventStarted:
		return "started"
	case EventStopped:
		return "stopped"
	case EventCompleted:
		return "completed"
	default:
		return "update"
	}
}

// Request is a parsed (but not yet validated against DB) announce request.
type Request struct {
	InfoHash   [InfoHashLen]byte
	PeerID     [PeerIDLen]byte
	Port       uint16
	Uploaded   int64
	Downloaded int64
	Left       int64
	Event      Event
	Compact    bool
	NumWant    int
	Passkey    string
}

// Errors returned by Parse. Each maps to a "failure reason" the tracker
// will echo back in bencode to the client.
var (
	ErrMissingInfoHash = errors.New("Missing info_hash")
	ErrInfoHashLen     = errors.New("Invalid info_hash length")
	ErrMissingPeerID   = errors.New("Missing peer_id")
	ErrPeerIDLen       = errors.New("Invalid peer_id length")
	ErrMissingPort     = errors.New("Missing port")
	ErrInvalidPort     = errors.New("Invalid port")
	ErrMissingPasskey  = errors.New("Passkey required")
)

// Parse decodes an announce request from URL query values.
//
// BitTorrent clients URL-encode the raw 20-byte info_hash and peer_id as
// query parameters; net/url already does the right thing with %xx, but we
// then need to assert the byte length is exactly 20.
func Parse(q url.Values) (*Request, error) {
	r := &Request{
		Compact: true,
		NumWant: 50,
	}

	ih := q.Get("info_hash")
	if ih == "" {
		return nil, ErrMissingInfoHash
	}
	if len(ih) != InfoHashLen {
		return nil, ErrInfoHashLen
	}
	copy(r.InfoHash[:], ih)

	pid := q.Get("peer_id")
	if pid == "" {
		return nil, ErrMissingPeerID
	}
	if len(pid) != PeerIDLen {
		return nil, ErrPeerIDLen
	}
	copy(r.PeerID[:], pid)

	portStr := q.Get("port")
	if portStr == "" {
		return nil, ErrMissingPort
	}
	port, err := strconv.ParseUint(portStr, 10, 16)
	if err != nil || port == 0 {
		return nil, ErrInvalidPort
	}
	r.Port = uint16(port)

	r.Uploaded, _ = parseInt64(q.Get("uploaded"))
	r.Downloaded, _ = parseInt64(q.Get("downloaded"))
	// `left` defaults to 1 (unknown / leeching) when missing or invalid, to
	// match the legacy bittorrent-tracker behavior.
	if v, ok := parseInt64(q.Get("left")); ok {
		r.Left = v
	} else {
		r.Left = 1
	}

	switch q.Get("event") {
	case "started":
		r.Event = EventStarted
	case "stopped":
		r.Event = EventStopped
	case "completed":
		r.Event = EventCompleted
	default:
		r.Event = EventNone
	}

	if v := q.Get("compact"); v == "0" {
		r.Compact = false
	}
	if v := q.Get("numwant"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			r.NumWant = n
		}
	}
	if r.NumWant > 100 {
		r.NumWant = 100
	}

	r.Passkey = q.Get("passkey")
	if r.Passkey == "" {
		return nil, ErrMissingPasskey
	}

	return r, nil
}

// IsSeeder reports whether the announce describes a seeding peer (left == 0).
func (r *Request) IsSeeder() bool { return r.Left == 0 }

func parseInt64(s string) (int64, bool) {
	if s == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}
