package server

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/florianjs/trackarr/apps/tracker/internal/announce"
	"github.com/florianjs/trackarr/apps/tracker/internal/bencode"
	"github.com/florianjs/trackarr/apps/tracker/internal/bonus"
	"github.com/florianjs/trackarr/apps/tracker/internal/cryptohash"
	dbpkg "github.com/florianjs/trackarr/apps/tracker/internal/db"
	"github.com/florianjs/trackarr/apps/tracker/internal/peers"
	"github.com/florianjs/trackarr/apps/tracker/internal/queries"
)

// hnrWorkerSlots caps how many HnR background goroutines can run in
// parallel. Each one holds a pgx connection on `pgxpool.Pool`
// (default 20 connections in our config), so without a ceiling a
// burst of `event=completed` announces could exhaust the pool and
// block legitimate requests on `acquire`. 8 slots leaves headroom
// for the announce hot path while still letting HnR catch up under
// load.
const hnrWorkerSlots = 8

// Server holds shared state for the HTTP handlers.
type Server struct {
	db           *dbpkg.DB
	redis        *redis.Client
	peers        *peers.Store
	bonus        *bonus.Resolver
	dedup        *dedup
	ipHashSecret string
	debug        bool
	// appCtx is the process-lifecycle context. Background goroutines spawned
	// from a request derive their own timeouts from this so they cancel when
	// the server shuts down rather than running on context.Background().
	appCtx context.Context
	// hnrSlots is a buffered semaphore — `<- hnrSlots` reserves a
	// worker slot, `hnrSlots <- struct{}{}` releases it. Ensures the
	// HnR DB writes never overshoot the connection pool budget.
	hnrSlots chan struct{}
}

// New builds a Server. It does not start listening — callers wire it into
// http.Handler routes themselves so tests can use httptest directly.
// appCtx should be the process-lifecycle context (cancelled on shutdown).
// `redisKeyPrefix` must match the API's REDIS_KEY_PREFIX so the bonus
// resolver reads the same Redis snapshot the API writes.
func New(appCtx context.Context, db *dbpkg.DB, rclient *redis.Client, store *peers.Store, redisKeyPrefix, ipHashSecret string, debug bool) *Server {
	if appCtx == nil {
		appCtx = context.Background()
	}
	slots := make(chan struct{}, hnrWorkerSlots)
	// Pre-fill so the channel acts as a "tickets available" pool —
	// goroutines acquire by reading, release by sending back.
	for i := 0; i < hnrWorkerSlots; i++ {
		slots <- struct{}{}
	}
	return &Server{
		db:           db,
		redis:        rclient,
		peers:        store,
		bonus:        bonus.New(rclient, redisKeyPrefix),
		dedup:        newDedup(),
		ipHashSecret: ipHashSecret,
		debug:        debug,
		appCtx:       appCtx,
		hnrSlots:     slots,
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

// minAnnounceLatency floors every announce response to this duration.
// A valid passkey hits Postgres + Redis (a few ms each) and finishes
// in tens of ms; an invalid passkey returns immediately on
// `pgx.ErrNoRows`. The unfiltered gap (sub-ms vs ~10–30 ms) is a
// trivially observable side channel for passkey enumeration. Sleeping
// the response up to this threshold collapses that signal without
// adding meaningful latency for legitimate traffic.
const minAnnounceLatency = 30 * time.Millisecond

func (s *Server) handleAnnounce(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	defer func() {
		if elapsed := time.Since(start); elapsed < minAnnounceLatency {
			time.Sleep(minAnnounceLatency - elapsed)
		}
	}()

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")

	req, err := announce.Parse(r.URL.Query())
	if err != nil {
		writeFailure(w, err.Error())
		return
	}

	infoHashHex := hexBytes(req.InfoHash[:])
	ctx := r.Context()

	// 1. Resolve & validate the user
	user, err := s.db.Q.FindUserByPasskey(ctx, req.Passkey)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
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
		minRatio, err := s.db.GetMinRatio(ctx)
		if err == nil && minRatio > 0 && user.Downloaded > 0 {
			ratio := float64(user.Uploaded) / float64(user.Downloaded)
			if ratio < minRatio {
				writeFailure(w, "Low ratio. Download disabled.")
				return
			}
		}
	}

	// 3. Torrent must exist and be active. We capture the row's id —
	// previously discarded — so step 6 can persist per-(user, torrent)
	// byte deltas into hnr_tracking without an extra round-trip.
	torrentID, err := s.db.Q.FindActiveTorrentByInfoHash(ctx, infoHashHex)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
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

	// 5a. Sanity-cap the per-announce delta. A malicious client can
	// claim arbitrary int64 values for `uploaded`/`downloaded` query
	// params; combined with a Bonus Event 10× upload multiplier this
	// would overflow int64 on the multiplication below and silently
	// poison the user's lifetime counters. 1 TiB per announce is
	// already two orders of magnitude beyond what any honest client
	// could legitimately push between two announces, so anything
	// above is dropped to the cap.
	const maxDeltaPerAnnounce int64 = 1 << 40 // 1 TiB
	if deltaUp > maxDeltaPerAnnounce {
		slog.Warn("clamping unrealistic upload delta",
			"info_hash", infoHashHex,
			"peer_id", peerHex,
			"claimed", deltaUp,
		)
		deltaUp = maxDeltaPerAnnounce
	}
	if deltaDown > maxDeltaPerAnnounce {
		slog.Warn("clamping unrealistic download delta",
			"info_hash", infoHashHex,
			"peer_id", peerHex,
			"claimed", deltaDown,
		)
		deltaDown = maxDeltaPerAnnounce
	}

	// 5b. Apply the active bonus event multipliers (Freeleech /
	// Silverleech / custom) before persisting. The resolver reads
	// from a 30 s in-memory cache backed by Redis, so this is a
	// near-zero-cost call when no event is active. With identity
	// (1x/1x) the deltas are unchanged. The cap above guarantees
	// the multiplication can never overflow int64
	// (1 TiB × 1000 / 100 = 10 TiB ≪ 9.2 EiB).
	mults := s.bonus.Get(ctx)
	deltaUp, deltaDown = mults.Apply(deltaUp, deltaDown)

	// 6. Persist user stats deltas (best-effort: log but don't reject).
	// We bump both the global counter (`users.uploaded/downloaded`) and
	// the per-torrent counter inside hnr_tracking. The latter creates a
	// tracking row on the first non-zero delta so the Downloads page in
	// the web UI can show a torrent before the user has completed it.
	if deltaUp > 0 || deltaDown > 0 {
		if err := s.db.Q.IncrementUserStats(ctx, queries.IncrementUserStatsParams{
			Uploaded:   deltaUp,
			Downloaded: deltaDown,
			Passkey:    req.Passkey,
		}); err != nil {
			slog.Warn("failed to increment user stats",
				"info_hash", infoHashHex,
				"peer_id", peerHex,
				"event", req.Event.String(),
				"err", err)
		}
		// Hot-path-first: try a plain UPDATE. The row almost always
		// exists by the time we get here — either the API stamped one
		// when the user pulled the .torrent file, or a previous
		// announce already created one. The UPDATE pays no crypto-rand,
		// no FK index check, no dead-tuple churn, and skips the
		// settings cache lookup entirely.
		//
		// Cold path: rows == 0 means we're seeing the very first
		// announce for this (user, torrent) pair. Generate an id, read
		// the cached required_seed_time, and do the INSERT … ON
		// CONFLICT DO NOTHING (race-safe against a concurrent click
		// from the API that's mid-flight). All errors here are
		// best-effort — we never fail the announce because of
		// bookkeeping.
		rows, bumpErr := s.db.Q.BumpUserTorrentBytes(ctx, queries.BumpUserTorrentBytesParams{
			Uploaded:   deltaUp,
			Downloaded: deltaDown,
			UserID:     user.ID,
			TorrentID:  torrentID,
		})
		if bumpErr != nil {
			slog.Warn("failed to bump per-torrent bytes",
				"info_hash", infoHashHex,
				"peer_id", peerHex,
				"event", req.Event.String(),
				"err", bumpErr)
		} else if rows == 0 {
			newID, idErr := dbpkg.NewID()
			if idErr != nil {
				slog.Warn("hnr id generation (bytes)",
					"info_hash", infoHashHex, "err", idErr)
			} else {
				required, _ := s.db.GetHnrRequiredSeedTime(ctx)
				if err := s.db.Q.InsertUserTorrentBytes(ctx, queries.InsertUserTorrentBytesParams{
					ID:               newID,
					UserID:           user.ID,
					TorrentID:        torrentID,
					RequiredSeedTime: required,
					Uploaded:         deltaUp,
					Downloaded:       deltaDown,
				}); err != nil {
					slog.Warn("failed to seed per-torrent bytes row",
						"info_hash", infoHashHex,
						"peer_id", peerHex,
						"event", req.Event.String(),
						"err", err)
				}
			}
		}
	}

	// 7. event=stopped: remove peer and respond
	if req.Event == announce.EventStopped {
		_ = s.peers.Remove(ctx, infoHashHex, peerHex)
		s.writeAnnounceResponse(ctx, w, infoHashHex, req)
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
			go s.recordSeedTime(req.Passkey, infoHashHex, int32(elapsed))
		}
	}

	// 11. Build the announce response with the current swarm state
	s.writeAnnounceResponse(ctx, w, infoHashHex, req)
}

// writeMinimalSuccess is the response we emit when we hit the dedup cache.
// We still include peer counts so the client UI shows seed/leech numbers.
func (s *Server) writeMinimalSuccess(ctx context.Context, w http.ResponseWriter, infoHashHex string, req *announce.Request) {
	seeders, leechers, _ := s.peers.Counts(ctx, infoHashHex)
	body := buildAnnounceResponse(seeders, leechers, nil, req.Compact, req.PeerID, req.NumWant)
	_, _ = w.Write(body)
}

// writeAnnounceResponse fetches the current peer list and emits the bencode dict.
func (s *Server) writeAnnounceResponse(ctx context.Context, w http.ResponseWriter, infoHashHex string, req *announce.Request) {
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
//
// Both recorders bracket their work with a hnrSlots semaphore so the
// pgx connection pool isn't drained by a burst of `event=completed`
// announces. They also fail-closed on the HnR config queries: if we
// can't tell whether HnR is enabled, the safer default is to not
// silently skip credit (which would make every user a free leecher
// during a DB hiccup) — we abort and let the next announce retry.
// ----------------------------------------------------------------------------

// hnrAcquire reserves a worker slot, returning false if the server
// is shutting down before one becomes free.
func (s *Server) hnrAcquire(ctx context.Context) bool {
	select {
	case <-s.hnrSlots:
		return true
	case <-ctx.Done():
		return false
	}
}

func (s *Server) hnrRelease() {
	s.hnrSlots <- struct{}{}
}

func (s *Server) recordHnrCompletion(passkey, infoHashHex string) {
	ctx, cancel := context.WithTimeout(s.appCtx, 5*time.Second)
	defer cancel()
	if !s.hnrAcquire(ctx) {
		return
	}
	defer s.hnrRelease()

	enabled, err := s.db.IsHnrEnabled(ctx)
	if err != nil {
		slog.Warn("hnr enabled lookup", "info_hash", infoHashHex, "err", err)
		return
	}
	if !enabled {
		return
	}
	required, err := s.db.GetHnrRequiredSeedTime(ctx)
	if err != nil {
		slog.Warn("hnr required seed time", "info_hash", infoHashHex, "err", err)
		return
	}

	row, err := s.db.Q.FindUserAndTorrentByPasskeyAndHash(ctx,
		queries.FindUserAndTorrentByPasskeyAndHashParams{
			Passkey:  passkey,
			InfoHash: infoHashHex,
		})
	if err != nil {
		return
	}

	id, err := dbpkg.NewID()
	if err != nil {
		slog.Warn("hnr id generation", "info_hash", infoHashHex, "err", err)
		return
	}
	err = s.db.Q.CreateHnrEntry(ctx, queries.CreateHnrEntryParams{
		ID:               id,
		UserID:           row.UserID,
		TorrentID:        row.TorrentID,
		RequiredSeedTime: required,
	})
	if err != nil {
		slog.Warn("create hnr entry", "info_hash", infoHashHex, "err", err)
	}
}

func (s *Server) recordSeedTime(passkey, infoHashHex string, secondsToAdd int32) {
	ctx, cancel := context.WithTimeout(s.appCtx, 5*time.Second)
	defer cancel()
	if !s.hnrAcquire(ctx) {
		return
	}
	defer s.hnrRelease()

	row, err := s.db.Q.FindUserAndTorrentByPasskeyAndHash(ctx,
		queries.FindUserAndTorrentByPasskeyAndHashParams{
			Passkey:  passkey,
			InfoHash: infoHashHex,
		})
	if err != nil {
		return
	}

	err = s.db.Q.AddSeedTime(ctx, queries.AddSeedTimeParams{
		SeedTime:  secondsToAdd,
		UserID:    row.UserID,
		TorrentID: row.TorrentID,
	})
	if err != nil {
		slog.Warn("update seed time",
			"info_hash", infoHashHex,
			"seconds", secondsToAdd,
			"err", err)
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

	dbOK := s.db.Pool.Ping(ctx) == nil
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
// forge any IP. Header values are validated as real IP literals so a
// malformed/garbage header just falls through to RemoteAddr.
func (s *Server) clientIP(r *http.Request) string {
	if trustProxy {
		if v := r.Header.Get("X-Real-IP"); v != "" {
			if ip := net.ParseIP(strings.TrimSpace(v)); ip != nil {
				return ip.String()
			}
		}
		if v := r.Header.Get("X-Forwarded-For"); v != "" {
			candidate := v
			if i := strings.IndexByte(v, ','); i >= 0 {
				candidate = v[:i]
			}
			if ip := net.ParseIP(strings.TrimSpace(candidate)); ip != nil {
				return ip.String()
			}
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
