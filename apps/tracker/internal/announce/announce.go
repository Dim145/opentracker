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
	// EventPaused is BEP 21's partial-seed signal. A client that holds every
	// piece it asked for — but not the whole torrent, because the member
	// deselected files — reports `left=0` and `event=paused`. It is still
	// worth connecting to: it has real pieces to serve. It is simply not a
	// seed, and BEP 21 asks the tracker not to report it as one.
	//
	// HTTP only. BEP 15 numbers its events 0..3 and has no code for this, so a
	// UDP announce can never carry it.
	EventPaused
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
	case EventPaused:
		return "paused"
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
	// UnknownEventRaw carries the raw `event` query value when it
	// doesn't match any spec'd token. Empty for absent or recognised
	// events. The handler logs this at info level when present so an
	// operator can spot misbehaving / experimental clients.
	UnknownEventRaw string
	Passkey         string
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
// ValidPeerPort dit si un port peut être inscrit dans un essaim.
//
// Deux règles, et la même aux deux transports :
//
//   - Zéro est refusé. Un pair à `IP:0` n'est joignable par personne, et il est
//     pourtant distribué à tous les clients de l'essaim, qui y brûlent leur
//     budget de connexions. L'analyseur HTTP le refusait déjà ;
//     `ToAnnounceRequest` recopiait le port UDP sans contrôle, si bien que la
//     règle ne tenait que sur la moitié des annonces.
//   - Les ports privilégiés sont refusés. Un pair pouvait s'inscrire sur
//     `<son IP>:22` ou `:25`, et l'essaim entier allait y frapper en TCP. Comme
//     l'adresse vient du socket, ce n'est pas un réflecteur vers un tiers
//     arbitraire — mais derrière un CGNAT l'adresse est partagée, et c'est la
//     raison pour laquelle les trackers de référence bloquent cette plage.
func ValidPeerPort(port uint16) bool {
	return port >= 1024
}

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
	if err != nil || !ValidPeerPort(uint16(port)) {
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

	switch ev := q.Get("event"); ev {
	case "":
		r.Event = EventNone
	case "started":
		r.Event = EventStarted
	case "stopped":
		r.Event = EventStopped
	case "completed":
		r.Event = EventCompleted
	case "paused":
		// BEP 21. Recognised rather than swallowed, which is what lets the
		// peer be classified correctly below — and it is a real client
		// behaviour, not an exotic one: qBittorrent sends it whenever a member
		// downloads only some files of a multi-file torrent. Trackers that
		// reject the value outright break those clients; we never did, but we
		// did count the peer as a seed, which inflated the swarm's seeder
		// count and made the torrent look healthier than it was.
		r.Event = EventPaused
	default:
		// Per BEP 3, unknown events are equivalent to a periodic
		// announce (no event). We still want operator visibility so
		// we record the raw value on the request; the HTTP handler
		// logs it at info-level if `TRACKER_DEBUG` is on. Treating
		// it as `EventNone` (not rejecting) keeps Trackarr lenient
		// with clients that invent custom event values.
		r.Event = EventNone
		r.UnknownEventRaw = ev
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

// IsSeeder reports whether the announce describes a seeding peer.
//
// `left == 0` is necessary and no longer sufficient: a BEP 21 partial seed has
// nothing left to fetch of what it asked for, yet does not hold the torrent. It
// stays in the swarm — it has pieces others want — and counts as a leecher, so
// the seeder count means what a member reads it to mean.
func (r *Request) IsSeeder() bool { return r.Left == 0 && r.Event != EventPaused }

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
