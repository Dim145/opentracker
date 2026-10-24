package server

import (
	"net"
	"sync"
	"time"
)

// lookupGuard refuses, without touching Postgres or Redis, a client that keeps
// presenting passkeys that match no account — on /announce, over HTTP and UDP,
// and on the HTTP /scrape, which costs the same query.
//
// Each such announce used to cost a Redis GET and a Postgres query (misses are
// deliberately not cached, so a member created a second ago can announce). A
// scanner cycling through random passkeys was therefore a database load
// generator. After `maxLookupFailures` failures in a minute, the address is
// answered from memory for the rest of that minute. Counted per replica, which
// is enough: the point is the database, and each replica guards its own share
// of it.
//
// An unknown info hash under a VALID passkey is not counted. That is a member's
// client still announcing a torrent the site removed; after a purge, a single
// restart sends hundreds of them at once, and counting them locked the member —
// and everyone sharing the address, a seedbox host's other customers say — out
// of the torrents that do exist.
//
// IPv6 is counted per /64, the smallest block a subscriber is handed: a host
// that can pick a fresh address for every request would otherwise never meet
// the limit.
type lookupGuard struct {
	mu      sync.Mutex
	windows map[string]*lookupWindow
}

type lookupWindow struct {
	start    time.Time
	failures int
}

const (
	maxLookupFailures = 120
	lookupWindowSpan  = time.Minute
	// A flood of distinct addresses must not grow the map without bound: past
	// this size the stale windows are swept, and if every window is live the
	// map is reset — the guard forgets, the database is still protected by the
	// shape check and the per-announce cost.
	maxLookupWindows = 100_000
)

func newLookupGuard() *lookupGuard {
	return &lookupGuard{windows: make(map[string]*lookupWindow)}
}

// subject is the address for IPv4, its /64 for IPv6.
func lookupSubject(ip string) string {
	parsed := net.ParseIP(ip)
	if parsed == nil || parsed.To4() != nil {
		return ip
	}
	return parsed.Mask(net.CIDRMask(64, 128)).String() + "/64"
}

// blocked reports whether this address has used up its failures for the
// current window.
func (g *lookupGuard) blocked(ip string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	w, ok := g.windows[lookupSubject(ip)]
	return ok && now.Sub(w.start) < lookupWindowSpan && w.failures >= maxLookupFailures
}

// fail records one announce that could not succeed.
func (g *lookupGuard) fail(ip string, now time.Time) {
	g.mu.Lock()
	defer g.mu.Unlock()
	key := lookupSubject(ip)
	w, ok := g.windows[key]
	if !ok || now.Sub(w.start) >= lookupWindowSpan {
		if !ok && len(g.windows) >= maxLookupWindows {
			g.sweep(now)
		}
		g.windows[key] = &lookupWindow{start: now, failures: 1}
		return
	}
	w.failures++
}

func (g *lookupGuard) sweep(now time.Time) {
	for k, w := range g.windows {
		if now.Sub(w.start) >= lookupWindowSpan {
			delete(g.windows, k)
		}
	}
	if len(g.windows) >= maxLookupWindows {
		g.windows = make(map[string]*lookupWindow)
	}
}

// plausiblePasskey is the shape check that runs before any lookup: lowercase or
// uppercase hex, 32 to 64 characters. The site mints 40; the range keeps any
// older key format working.
func plausiblePasskey(p string) bool {
	if len(p) < 32 || len(p) > 64 {
		return false
	}
	for i := 0; i < len(p); i++ {
		c := p[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}
