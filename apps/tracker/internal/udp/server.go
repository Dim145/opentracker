package udp

import (
	"context"
	"encoding/binary"
	"errors"
	"log/slog"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/florianjs/trackarr/apps/tracker/internal/announce"
	"github.com/florianjs/trackarr/apps/tracker/internal/peers"
	"github.com/florianjs/trackarr/apps/tracker/internal/server"
)

// maxUDPPacket caps the per-recv buffer at the practical upper bound
// for an announce: the 98-byte fixed body + the BEP 41 URL_DATA option
// (clients in the wild emit at most a few hundred bytes here) +
// generous slack. 1500 bytes matches a vanilla Ethernet MTU and is
// what every public BT tracker listens for; anything larger is almost
// certainly a probe/junk packet and we let the kernel truncate.
const maxUDPPacket = 1500

// Server runs the UDP listener, dispatches packets to the right
// action handler, and adapts announces into the wire-agnostic
// processor on `internal/server`.
//
// The struct is small on purpose: state is in `processor` (which owns
// Postgres, Redis, dedup) and `connID` (which is stateless via HMAC).
// We add nothing that would force the caller to think about cache
// coherence between the HTTP and UDP frontends.
type Server struct {
	conn    *net.UDPConn
	connID  *ConnIDIssuer
	addr    *net.UDPAddr
	proc    *server.Server
	store   *peers.Store
	logger  *slog.Logger
	bufPool sync.Pool
}

// New builds a UDP server bound to `addr` and ready to dispatch
// announces into `proc`. `addr` is in the same shape as `:6969`.
//
// Binding happens here (rather than in Start) so the caller can fail
// fast on a port conflict at boot — same pattern as `http.Server.Listen`
// happens inside `ListenAndServe`, but exposed earlier.
func New(addr string, secret string, proc *server.Server, store *peers.Store) (*Server, error) {
	udpAddr, err := net.ResolveUDPAddr("udp", addr)
	if err != nil {
		return nil, err
	}
	conn, err := net.ListenUDP("udp", udpAddr)
	if err != nil {
		return nil, err
	}
	s := &Server{
		conn:   conn,
		connID: NewConnIDIssuer(secret),
		addr:   udpAddr,
		proc:   proc,
		store:  store,
		logger: slog.Default(),
	}
	s.bufPool = sync.Pool{
		New: func() any {
			b := make([]byte, maxUDPPacket)
			return &b
		},
	}
	return s, nil
}

// Addr returns the actual listening address — useful in tests when we
// bind to `:0` and need to discover the kernel-assigned port.
func (s *Server) Addr() *net.UDPAddr { return s.addr }

// Serve runs the read loop until ctx is cancelled or the socket is
// closed. Every packet spawns a goroutine that handles the packet end-
// to-end (parse → dispatch → write); the read loop itself never
// blocks on Postgres/Redis so a slow announce can't stall the listener.
//
// Read deadlines are set per-loop (1 s) so a Close() call from
// Shutdown() makes the loop wake within ~1 s and exit cleanly. UDP
// has no connection state to drain — closing the socket is enough.
func (s *Server) Serve(ctx context.Context) error {
	for {
		// Wake the loop periodically so ctx cancellation is visible
		// even when no packets arrive.
		_ = s.conn.SetReadDeadline(time.Now().Add(1 * time.Second))

		bufp := s.bufPool.Get().(*[]byte)
		buf := *bufp
		n, raddr, err := s.conn.ReadFromUDP(buf)
		if err != nil {
			s.bufPool.Put(bufp)
			if ctx.Err() != nil {
				return nil
			}
			var nerr net.Error
			if errors.As(err, &nerr) && nerr.Timeout() {
				continue
			}
			// Unexpected — log and exit. The supervisor (`main.go`)
			// will tear down the rest of the process.
			return err
		}
		// Hand the packet off; the goroutine returns the buffer to
		// the pool when done.
		go s.handlePacket(ctx, bufp, n, raddr)
	}
}

// Close stops the server. The `Serve` loop returns nil shortly after.
func (s *Server) Close() error { return s.conn.Close() }

// handlePacket routes a single datagram by its action code. Anything
// shorter than the fixed connect header is dropped silently — UDP is
// lossy by design and a garbage packet is indistinguishable from a
// scanner probe; we don't log every one or we'd flood ourselves out
// of disk on a busy tracker.
func (s *Server) handlePacket(ctx context.Context, bufp *[]byte, n int, raddr *net.UDPAddr) {
	defer s.bufPool.Put(bufp)
	data := (*bufp)[:n]
	if n < 16 {
		return
	}
	// Distinguish connect (matches the magic) from action-bearing
	// packets (announce/scrape) by inspecting the first 8 bytes:
	// connect's magic is unique enough that a client never accidentally
	// sends an announce that begins with it.
	magic := binary.BigEndian.Uint64(data[0:8])
	action := binary.BigEndian.Uint32(data[8:12])
	switch {
	case magic == magicProtocolID && action == ActionConnect:
		s.handleConnect(data, raddr)
	case action == ActionAnnounce:
		s.handleAnnounce(ctx, data, raddr)
	case action == ActionScrape:
		s.handleScrape(ctx, data, raddr)
	default:
		// Drop unknown action. We could send action=3 with "Bad
		// action" but that risks turning the tracker into a small
		// reflector for spoofed source IPs.
	}
}

// handleConnect emits a 16-byte response with a freshly issued
// connection_id. We don't validate anything besides the magic — the
// client is identified by source IP only at this stage, and the
// server keeps no per-id state.
func (s *Server) handleConnect(data []byte, raddr *net.UDPAddr) {
	req, err := ParseConnect(data)
	if err != nil {
		s.logger.Debug("udp connect parse failed", "remote", raddr.String(), "err", err)
		return
	}
	id := s.connID.Issue(raddr.IP)
	out := EncodeConnectResponse(nil, req.TransactionID, id)
	_, _ = s.conn.WriteToUDP(out, raddr)
	s.logger.Debug("udp connect ok", "remote", raddr.String())
}

// handleAnnounce parses an announce, validates the connection_id and
// the BEP 41-encoded passkey, then funnels everything into the
// wire-agnostic `ProcessAnnounce`. The result is encoded back into a
// BEP 15 announce response.
//
// Per BEP 15 §2 ("Errors"), a malformed request gets an action=3
// error reply with a short ASCII reason. We reuse the same vocabulary
// the HTTP path returns ("Invalid passkey", "Low ratio…", etc.) so an
// operator's logs stay consistent across transports.
//
// Every rejection path logs at info level. UDP otherwise fails very
// quietly — the client just sees "tracker error" and the operator
// has nothing to grep — so we trade a bit of log volume for
// debuggability. The hot path (successful announces) only logs at
// debug.
func (s *Server) handleAnnounce(ctx context.Context, data []byte, raddr *net.UDPAddr) {
	req, err := ParseAnnounce(data)
	if err != nil {
		// Without a valid transaction id we can't address the reply
		// — drop silently rather than reflect a forged source. Still
		// log so the operator can see if a probe / scanner is
		// hammering the port.
		s.logger.Warn("udp announce parse failed",
			"remote", raddr.String(),
			"size", len(data),
			"err", err,
		)
		return
	}
	if !s.connID.Validate(raddr.IP, req.ConnectionID) {
		s.logger.Info("udp connection_id rejected",
			"remote", raddr.String(),
			"reason", "missing or expired (re-handshake needed)",
		)
		_, _ = s.conn.WriteToUDP(
			EncodeError(nil, req.TransactionID, "Connection ID expired"),
			raddr,
		)
		return
	}
	apiReq, err := req.ToAnnounceRequest()
	if err != nil {
		// Passkey absent from the BEP 41 URL_DATA. The vast majority
		// of these come from a client configured with
		// `udp://host:6969/announce` (no path / query). Echo the URL
		// data back so the operator can see what arrived — that's the
		// fastest way to diagnose a missing or wrong-shape passkey.
		urlData := string(req.URLData)
		if len(urlData) > 200 {
			urlData = urlData[:200] + "…"
		}
		s.logger.Info("udp announce missing passkey",
			"remote", raddr.String(),
			"url_data", urlData,
			"hint", "client must use udp://host:port/announce/PASSKEY or ?passkey=PASSKEY",
		)
		_, _ = s.conn.WriteToUDP(
			EncodeError(nil, req.TransactionID, "Passkey required"),
			raddr,
		)
		return
	}

	clientIP := udpClientIP(req, raddr)
	out := s.proc.ProcessAnnounce(ctx, apiReq, clientIP)
	if out.Failure != "" {
		// Failure carries the user-facing reason ("Invalid passkey",
		// "Low ratio…", "Torrent not found or inactive"). Surface it
		// alongside the remote so the operator can correlate with a
		// specific peer.
		s.logger.Info("udp announce rejected",
			"remote", raddr.String(),
			"reason", out.Failure,
		)
		_, _ = s.conn.WriteToUDP(
			EncodeError(nil, req.TransactionID, out.Failure),
			raddr,
		)
		return
	}

	// Convert the announcer's peer_id back to the same hex shape the
	// peer store uses internally, so the encoder can skip its own
	// row when fanning out the swarm.
	excludeHex := hexBytes(req.PeerID[:])
	resp := EncodeAnnounceResponse(
		nil,
		req.TransactionID,
		out.Interval,
		out.Leechers,
		out.Seeders,
		out.Peers,
		excludeHex,
		int(req.NumWant),
	)
	_, _ = s.conn.WriteToUDP(resp, raddr)
	s.logger.Debug("udp announce ok",
		"remote", raddr.String(),
		"seeders", out.Seeders,
		"leechers", out.Leechers,
		"peer_count", len(out.Peers),
	)
}

// handleScrape answers a UDP scrape — same data shape as the HTTP
// scrape, but binary. No passkey requirement: a UDP scrape only
// returns counts (no peer addresses, no IPs) so it's safe to expose
// publicly, just like every other public BT tracker does.
func (s *Server) handleScrape(ctx context.Context, data []byte, raddr *net.UDPAddr) {
	if len(data) < scrapeReqMinLen {
		return
	}
	connID := binary.BigEndian.Uint64(data[0:8])
	txID := binary.BigEndian.Uint32(data[12:16])
	if !s.connID.Validate(raddr.IP, connID) {
		_, _ = s.conn.WriteToUDP(
			EncodeError(nil, txID, "Connection ID expired"),
			raddr,
		)
		return
	}

	hashes := data[scrapeReqMinLen:]
	count := len(hashes) / infoHashSize
	if count == 0 {
		return
	}
	if count > maxScrapeHashes {
		count = maxScrapeHashes
	}
	stats := make([]ScrapeStat, count)
	for i := 0; i < count; i++ {
		ih := hashes[i*infoHashSize : (i+1)*infoHashSize]
		hex := hexBytes(ih)
		seeders, leechers, _ := s.store.Counts(ctx, hex)
		completed, _ := s.store.CompletedCount(ctx, hex)
		stats[i] = ScrapeStat{
			Seeders:   seeders,
			Completed: completed,
			Leechers:  leechers,
		}
	}
	_, _ = s.conn.WriteToUDP(EncodeScrapeResponse(nil, txID, stats), raddr)
}

// udpClientIP picks the IP we'll record against the peer. BEP 15 lets
// the client put a 4-byte IPv4 in the packet ("if 0, use sender") —
// we deliberately ignore it. Trusting an in-packet IP would let any
// peer announce on behalf of arbitrary IPv4 addresses, which is the
// classic tracker source-spoofing attack. Source addr only.
//
// `req` is currently unused but kept in the signature so a future
// `TRUST_PROXY` analogue (e.g. an envelope from an explicit relay)
// has somewhere to land without re-plumbing every call site.
func udpClientIP(_ *AnnounceRequestUDP, raddr *net.UDPAddr) string {
	return raddr.IP.String()
}

// hexBytes is a UDP-package-local copy of the same helper in
// `internal/server/response.go`. Duplicated rather than re-exported
// to keep the dependency surface flat (server depends on nothing UDP-
// specific; UDP only depends on the announce/peers/server triplet).
func hexBytes(b []byte) string {
	const hexdigits = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, v := range b {
		out[i*2] = hexdigits[v>>4]
		out[i*2+1] = hexdigits[v&0x0f]
	}
	return string(out)
}

// portStr is a small helper used by tests to materialise the bound
// address. Not used in the hot path.
func portStr(p int) string { return ":" + strconv.Itoa(p) }

// _ asserts the announce package is compiled in even if the package
// imports get reorganised — we rely on `announce.InfoHashLen` and
// related constants.
var _ = announce.InfoHashLen
