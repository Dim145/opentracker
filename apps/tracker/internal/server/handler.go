package server

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/florianjs/trackarr/apps/tracker/internal/announce"
	"github.com/florianjs/trackarr/apps/tracker/internal/bencode"
	"github.com/florianjs/trackarr/apps/tracker/internal/cryptohash"
	dbpkg "github.com/florianjs/trackarr/apps/tracker/internal/db"
	"github.com/florianjs/trackarr/apps/tracker/internal/peers"
)

// Server holds shared state for the HTTP handlers.
type Server struct {
	pool         *pgxpool.Pool
	redis        *redis.Client
	peers        *peers.Store
	dedup        *dedup
	ipHashSecret string
	debug        bool
}

// New builds a Server. It does not start listening — callers wire it into
// http.Handler routes themselves so tests can use httptest directly.
func New(pool *pgxpool.Pool, rclient *redis.Client, store *peers.Store, ipHashSecret string, debug bool) *Server {
	return &Server{
		pool:         pool,
		redis:        rclient,
		peers:        store,
		dedup:        newDedup(),
		ipHashSecret: ipHashSecret,
		debug:        debug,
	}
}

// Routes returns the http.Handler for /announce, /scrape and a health check.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/announce", s.handleAnnounce)
	mux.HandleFunc("/scrape", s.handleScrape)
	mux.HandleFunc("/health", s.handleHealth)
	return mux
}

// Stop releases the dedup goroutine.
func (s *Server) Stop() { s.dedup.Stop() }

// ----------------------------------------------------------------------------
// /announce
// ----------------------------------------------------------------------------

func (s *Server) handleAnnounce(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")

	req, err := announce.Parse(r.URL.Query())
	if err != nil {
		writeFailure(w, err.Error())
		return
	}

	infoHashHex := hexBytes(req.InfoHash[:])
	ctx := r.Context()

	// 1. Resolve & validate the user
	user, err := dbpkg.FindUserByPasskey(ctx, s.pool, req.Passkey)
	if err != nil {
		if errors.Is(err, dbpkg.ErrUserNotFound) {
			writeFailure(w, "Invalid passkey")
			return
		}
		s.serverError(w, "find user", err)
		return
	}
	if user.IsBanned {
		writeFailure(w, "User is banned")
		return
	}

	// 2. Ratio check (only when leeching: left > 0)
	if req.Left > 0 {
		minRatio, err := dbpkg.GetMinRatio(ctx, s.pool)
		if err == nil && minRatio > 0 && user.Downloaded > 0 {
			ratio := float64(user.Uploaded) / float64(user.Downloaded)
			if ratio < minRatio {
				writeFailure(w, "Low ratio. Download disabled.")
				return
			}
		}
	}

	// 3. Torrent must exist and be active
	if _, err := dbpkg.FindActiveTorrentByInfoHash(ctx, s.pool, infoHashHex); err != nil {
		if errors.Is(err, dbpkg.ErrTorrentNotFound) {
			writeFailure(w, "Torrent not found or inactive")
			return
		}
		s.serverError(w, "find torrent", err)
		return
	}

	// 4. Dedup window — skip if same {hash,peer,event} fired within 2 seconds
	peerHex := hexBytes(req.PeerID[:])
	dedupKey := infoHashHex + ":" + peerHex + ":" + req.Event.String()
	if !s.dedup.CheckAndMark(dedupKey) {
		// Tell the client we accepted the announce but don't redo any work.
		// Building the same response shape (with cached counts) is good
		// enough — the client only cares that it isn't an error.
		s.writeMinimalSuccess(ctx, w, infoHashHex, req)
		return
	}

	// 5. Calculate stats deltas vs the previous announce
	clientIP := s.clientIP(r)
	prev, _ := s.peers.Get(ctx, infoHashHex, peerHex)
	var deltaUp, deltaDown int64
	if prev != nil {
		if d := req.Uploaded - prev.Uploaded; d > 0 {
			deltaUp = d
		}
		if d := req.Downloaded - prev.Downloaded; d > 0 {
			deltaDown = d
		}
	}

	// 6. Persist user stats deltas (best-effort: log but don't reject)
	if err := dbpkg.IncrementUserStats(ctx, s.pool, req.Passkey, deltaUp, deltaDown); err != nil {
		slog.Warn("failed to increment user stats", "err", err)
	}

	// 7. event=stopped: remove peer and respond
	if req.Event == announce.EventStopped {
		_ = s.peers.Remove(ctx, infoHashHex, peerHex)
		s.writeAnnounceResponse(ctx, w, infoHashHex, req, nil)
		return
	}

	// 8. Upsert the peer
	ipHash := cryptohash.HashIP(clientIP, s.ipHashSecret)
	pdata := &peers.PeerData{
		PeerID:     peerHex,
		IP:         clientIP,
		IPHash:     ipHash,
		Port:       req.Port,
		Uploaded:   req.Uploaded,
		Downloaded: req.Downloaded,
		Left:       req.Left,
		IsSeeder:   req.IsSeeder(),
	}
	if err := s.peers.Set(ctx, infoHashHex, pdata); err != nil {
		s.serverError(w, "store peer", err)
		return
	}

	// 9. event=completed: bump the counter and create the HnR entry
	if req.Event == announce.EventCompleted {
		_ = s.peers.IncrementCompleted(ctx, infoHashHex)
		go s.recordHnrCompletion(req.Passkey, infoHashHex)
	}

	// 10. Seeders contribute to seed-time tracking
	if req.IsSeeder() && prev != nil {
		elapsed := (time.Now().UnixMilli() - prev.UpdatedAt) / 1000
		if elapsed > 0 && elapsed < 3600 {
			go s.recordSeedTime(req.Passkey, infoHashHex, elapsed)
		}
	}

	// 11. Build the announce response with the current swarm state
	s.writeAnnounceResponse(ctx, w, infoHashHex, req, &peerHex)
	_ = prev
}

// writeMinimalSuccess is the response we emit when we hit the dedup cache.
// We still include peer counts so the client UI shows seed/leech numbers.
func (s *Server) writeMinimalSuccess(ctx context.Context, w http.ResponseWriter, infoHashHex string, req *announce.Request) {
	seeders, leechers, _ := s.peers.Counts(ctx, infoHashHex)
	body := buildAnnounceResponse(seeders, leechers, nil, req.Compact, req.PeerID, req.NumWant)
	_, _ = w.Write(body)
}

// writeAnnounceResponse fetches the current peer list and emits the bencode dict.
func (s *Server) writeAnnounceResponse(ctx context.Context, w http.ResponseWriter, infoHashHex string, req *announce.Request, _ *string) {
	peerList, err := s.peers.List(ctx, infoHashHex)
	if err != nil {
		s.serverError(w, "list peers", err)
		return
	}
	seeders, leechers := 0, 0
	for _, p := range peerList {
		if p.IsSeeder {
			seeders++
		} else {
			leechers++
		}
	}
	body := buildAnnounceResponse(seeders, leechers, peerList, req.Compact, req.PeerID, req.NumWant)
	_, _ = w.Write(body)
}

// ----------------------------------------------------------------------------
// HnR background updates — best-effort, never fail the announce response.
// ----------------------------------------------------------------------------

func (s *Server) recordHnrCompletion(passkey, infoHashHex string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if enabled, _ := dbpkg.IsHnrEnabled(ctx, s.pool); !enabled {
		return
	}
	required, _ := dbpkg.GetHnrRequiredSeedTime(ctx, s.pool)
	userID, torrentID, err := dbpkg.FindUserAndTorrentIDs(ctx, s.pool, passkey, infoHashHex)
	if err != nil || userID == "" || torrentID == "" {
		return
	}
	if err := dbpkg.CreateHnrEntry(ctx, s.pool, userID, torrentID, required); err != nil {
		slog.Warn("create hnr entry", "err", err)
	}
}

func (s *Server) recordSeedTime(passkey, infoHashHex string, secondsToAdd int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	userID, torrentID, err := dbpkg.FindUserAndTorrentIDs(ctx, s.pool, passkey, infoHashHex)
	if err != nil || userID == "" || torrentID == "" {
		return
	}
	if err := dbpkg.UpdateSeedTime(ctx, s.pool, userID, torrentID, secondsToAdd); err != nil {
		slog.Warn("update seed time", "err", err)
	}
}

// ----------------------------------------------------------------------------
// /scrape
// ----------------------------------------------------------------------------

func (s *Server) handleScrape(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")

	hashes := r.URL.Query()["info_hash"]
	if len(hashes) == 0 {
		writeFailure(w, "Missing info_hash")
		return
	}
	if len(hashes) > 64 {
		writeFailure(w, "Too many info_hashes")
		return
	}

	ctx := r.Context()
	stats := make([]ScrapeStat, 0, len(hashes))
	for _, h := range hashes {
		if len(h) != announce.InfoHashLen {
			continue
		}
		var raw [announce.InfoHashLen]byte
		copy(raw[:], h)
		hex := hexBytes(raw[:])

		seeders, leechers, _ := s.peers.Counts(ctx, hex)
		completed, _ := s.peers.CompletedCount(ctx, hex)
		stats = append(stats, ScrapeStat{
			InfoHashRaw: raw,
			Seeders:     seeders,
			Leechers:    leechers,
			Completed:   completed,
		})
	}
	_, _ = w.Write(scrapeResponse(stats))
}

// ----------------------------------------------------------------------------
// /health
// ----------------------------------------------------------------------------

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()

	dbOK := s.pool.Ping(ctx) == nil
	redisOK := s.redis.Ping(ctx).Err() == nil

	if !dbOK || !redisOK {
		w.WriteHeader(http.StatusServiceUnavailable)
	}
	w.Header().Set("Content-Type", "application/json")
	body := `{"status":"healthy","db":` + boolStr(dbOK) + `,"redis":` + boolStr(redisOK) + `}`
	_, _ = w.Write([]byte(body))
}

func boolStr(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

// trustProxy controls whether X-Forwarded-For / X-Real-IP are honored. Same
// semantics as TRUST_PROXY in apps/api.
var trustProxy = false

// SetTrustProxy is called once at startup based on TRUST_PROXY env.
func SetTrustProxy(b bool) { trustProxy = b }

// clientIP extracts the announcing peer's IP. We only honor proxy headers
// when explicitly enabled, otherwise an attacker behind a proxy could
// forge any IP.
func (s *Server) clientIP(r *http.Request) string {
	if trustProxy {
		if v := r.Header.Get("X-Real-IP"); v != "" {
			return v
		}
		if v := r.Header.Get("X-Forwarded-For"); v != "" {
			if i := strings.IndexByte(v, ','); i >= 0 {
				return strings.TrimSpace(v[:i])
			}
			return strings.TrimSpace(v)
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func writeFailure(w http.ResponseWriter, reason string) {
	w.WriteHeader(http.StatusOK) // BT trackers MUST return 200 with bencode failure
	_, _ = w.Write(bencode.FailureResponse(reason))
}

func (s *Server) serverError(w http.ResponseWriter, where string, err error) {
	slog.Error("internal error", "where", where, "err", err)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(bencode.FailureResponse("Internal tracker error"))
}
