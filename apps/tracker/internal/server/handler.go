package server

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"

	"github.com/florianjs/trackarr/apps/tracker/internal/announce"
	"github.com/florianjs/trackarr/apps/tracker/internal/anticheat"
	"github.com/florianjs/trackarr/apps/tracker/internal/bencode"
	"github.com/florianjs/trackarr/apps/tracker/internal/bonus"
	"github.com/florianjs/trackarr/apps/tracker/internal/cryptohash"
	dbpkg "github.com/florianjs/trackarr/apps/tracker/internal/db"
	"github.com/florianjs/trackarr/apps/tracker/internal/peers"
	"github.com/florianjs/trackarr/apps/tracker/internal/queries"
)

// hnrMinWorkerSlots is the floor for the HnR background worker pool.
// Even on a 1-core container we want enough parallelism to absorb a
// small burst of `event=completed` announces without serialising them.
const hnrMinWorkerSlots = 8

// hnrWorkerSlots scales the HnR pool with available CPUs but never
// drops below the floor. Each worker holds a pgx connection while it
// writes the HnR row, so the maximum is bounded by what the pgxpool
// can supply (default 20 in our config). `GOMAXPROCS*2` is the usual
// rule of thumb for IO-bound workers — they spend most of their wall
// clock waiting on Postgres, so over-subscribing the cores is fine.
func hnrWorkerSlots() int {
	n := runtime.GOMAXPROCS(0) * 2
	if n < hnrMinWorkerSlots {
		n = hnrMinWorkerSlots
	}
	return n
}

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
	// bgTasks tracks background goroutines (HnR completion, seed-time
	// recording, etc.) so `Stop()` can wait for them to finish before
	// the process exits. Without this, a graceful shutdown would
	// drop in-flight DB writes — a `completed` announce arriving
	// during shutdown could lose its HnR entry and leak credit.
	bgTasks sync.WaitGroup
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
	n := hnrWorkerSlots()
	slots := make(chan struct{}, n)
	// Pre-fill so the channel acts as a "tickets available" pool —
	// goroutines acquire by reading, release by sending back.
	for i := 0; i < n; i++ {
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

// Stop tears the server down: stops the dedup eviction loop, then
// waits up to `bgDrainTimeout` for in-flight background tasks
// (HnR completion + seed-time recorders) to finish their pgx
// writes. Past the deadline we give up and let the process exit —
// the deferred contexts inside each worker already carry a 5 s
// timeout, so this only protects against a stuck DB.
func (s *Server) Stop() {
	s.dedup.Stop()

	done := make(chan struct{})
	go func() {
		s.bgTasks.Wait()
		close(done)
	}()
	select {
	case <-done:
		// Clean drain.
	case <-time.After(bgDrainTimeout):
		slog.Warn("server stop: background drain timed out — abandoning in-flight HnR writes")
	}
}

// bgDrainTimeout is the worst-case time we'll wait for background
// goroutines on shutdown. A bit longer than the per-worker DB timeout
// (5 s) so the slowest worker has time to finish naturally before we
// give up on it.
const bgDrainTimeout = 8 * time.Second

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

	clientIP := s.clientIP(r)
	if s.debug {
		// Surface the full proxy-header story so an operator can
		// diagnose "why is this peer registered with the wrong IP"
		// without having to add a one-off tcpdump on the origin.
		slog.Info("announce clientIP",
			"resolved", clientIP,
			"remoteAddr", r.RemoteAddr,
			"cfConnectingIP", r.Header.Get("CF-Connecting-IP"),
			"xForwardedFor", r.Header.Get("X-Forwarded-For"),
			"xRealIP", r.Header.Get("X-Real-IP"),
		)
	}
	if req.UnknownEventRaw != "" {
		// Clients with custom or buggy event values used to silently
		// reach the announce path as if they had sent nothing — useful
		// to know about for operator support / debugging interop.
		slog.Info("announce unknown event",
			"event", req.UnknownEventRaw,
			"clientIP", clientIP,
		)
	}
	out := s.ProcessAnnounce(r.Context(), req, clientIP, r.UserAgent())
	if out.Failure != "" {
		writeFailure(w, out.Failure)
		return
	}

	body := buildAnnounceResponse(out.Seeders, out.Leechers, out.Peers, req.Compact, req.PeerID, req.NumWant)
	_, _ = w.Write(body)
}

// AnnounceOutcome is the wire-agnostic result of processing an announce.
// The HTTP path renders it as bencode (`buildAnnounceResponse`); the UDP
// path encodes the peer list as a 6-byte-per-peer binary payload (BEP 15).
//
// The struct is exported so other transports (currently `internal/udp`)
// can reach it from outside the `server` package.
type AnnounceOutcome struct {
	// Failure, when non-empty, is a tracker-protocol failure reason
	// (e.g. "Invalid passkey", "Low ratio. Download disabled."). All
	// other fields are zero in this case. The wire layer renders this
	// as the protocol-specific error shape — bencode `failure reason`
	// for HTTP, action=3 for UDP.
	Failure string

	// Counts observed in the swarm at the moment the announce was
	// processed. Always populated on success — even on dedup hits and
	// on event=stopped responses, so the client UI can still show
	// current seed/leech numbers.
	Seeders  int
	Leechers int

	// Peers is the swarm snapshot the wire layer should send back.
	// Empty on event=stopped (the peer just left and doesn't need a
	// new list) and on dedup hits (we already gave them one a few
	// seconds ago). The wire layer is responsible for filtering by
	// NumWant and excluding the announcer's own peer_id.
	Peers []*peers.PeerData

	// Interval / MinInterval (seconds) are the gaps the client should
	// respect between announces. Constants today; surfaced through the
	// outcome so a future dynamic-interval feature has somewhere to
	// land without forking the wire layer.
	Interval    int
	MinInterval int
}

// ProcessAnnounce runs the wire-agnostic core of an announce: passkey
// resolution, ratio gate, torrent lookup, dedup, delta computation
// (with bonus multipliers), peer upsert, and HnR / seed-time
// bookkeeping. Returns enough data for the caller to render whatever
// response shape the client expects (bencode / BEP 15 binary).
//
// `clientIP` is the announcing peer's IP — the caller is responsible
// for extracting it correctly per its transport (HTTP X-Forwarded-For
// when trusted, UDP socket address, etc.). The min-latency floor lives
// in the HTTP wrapper, not here, because UDP timing-side-channel
// concerns are different (no single-shot round-trip a remote attacker
// can measure with sub-ms precision).
func (s *Server) ProcessAnnounce(ctx context.Context, req *announce.Request, clientIP, userAgent string) AnnounceOutcome {
	infoHashHex := hexBytes(req.InfoHash[:])

	// 1. Resolve & validate the user
	user, err := s.db.Q.FindUserByPasskey(ctx, req.Passkey)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AnnounceOutcome{Failure: "Invalid passkey"}
		}
		slog.Error("internal error", "where", "find user", "err", err)
		return AnnounceOutcome{Failure: "Internal tracker error"}
	}
	if user.IsBanned {
		return AnnounceOutcome{Failure: "User is banned"}
	}

	// 2. Ratio check (only when leeching: left > 0)
	if req.Left > 0 {
		minRatio, err := s.db.GetMinRatio(ctx)
		if err == nil && minRatio > 0 && user.Downloaded > 0 {
			ratio := float64(user.Uploaded) / float64(user.Downloaded)
			if ratio < minRatio {
				return AnnounceOutcome{Failure: "Low ratio. Download disabled."}
			}
		}
	}

	// 3. Torrent must exist and be active. We capture the row's id —
	// previously discarded — so step 6 can persist per-(user, torrent)
	// byte deltas into hnr_tracking without an extra round-trip.
	torrentID, err := s.db.Q.FindActiveTorrentByInfoHash(ctx, infoHashHex)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return AnnounceOutcome{Failure: "Torrent not found or inactive"}
		}
		slog.Error("internal error", "where", "find torrent", "err", err)
		return AnnounceOutcome{Failure: "Internal tracker error"}
	}

	// 4. Dedup window — skip if same {hash,peer,event} fired within 2 seconds
	peerHex := hexBytes(req.PeerID[:])
	dedupKey := infoHashHex + ":" + peerHex + ":" + req.Event.String()
	if !s.dedup.CheckAndMark(dedupKey) {
		seeders, leechers, _ := s.peers.Counts(ctx, infoHashHex)
		return AnnounceOutcome{
			Seeders:     seeders,
			Leechers:    leechers,
			Peers:       nil,
			Interval:    announceInterval,
			MinInterval: minAnnounceInterval,
		}
	}

	// 5. Calculate stats deltas vs the previous announce
	prev, _ := s.peers.Get(ctx, infoHashHex, peerHex)
	var deltaUp, deltaDown int64
	if prev != nil {
		if d := req.Uploaded - prev.Uploaded; d > 0 {
			deltaUp = d
		}
		if d := req.Downloaded - prev.Downloaded; d > 0 {
			deltaDown = d
		}
	} else if req.Event == announce.EventStarted {
		// First announce we see for this peer, and the client is
		// explicitly signalling `started`. Trust their declared
		// cumulative counters as the initial delta — otherwise every
		// client restart (or any gap > peerTTL) silently zeroes the
		// session's contribution to both `users.uploaded/downloaded`
		// and the per-(user, torrent) row in `hnr_tracking`.
		//
		// Spoofing window: a malicious client can claim arbitrary
		// counters on `started`. The 1 TiB per-announce cap below
		// already bounds the worst case, and a non-`started` first
		// announce still falls through to the zero-delta path — so
		// the exploit requires the attacker to advertise `started`
		// every time they want to inject bytes, which announce
		// rate-limiting + the existing user banning machinery can
		// catch.
		if req.Uploaded > 0 {
			deltaUp = req.Uploaded
		}
		if req.Downloaded > 0 {
			deltaDown = req.Downloaded
		}
	}

	// 5. Anti-cheat inspection. Runs BEFORE the 1 TiB sanity cap so
	// the detector sees the raw client claim — a velocity check on
	// the post-cap value would silently miss the 50 GB/s "I claim 1
	// TiB" announces RatioMaster-family scripts emit. The detector
	// only flags (never blocks): findings are appended to the
	// `anticheat_flags` table for the mod team to triage manually.
	// Best-effort: if Inspect returns anything, fire a goroutine
	// for the DB write so the announce path stays fast on its hot
	// edge.
	if deltaUp > 0 {
		preSeeders, preLeechers, _ := s.peers.Counts(ctx, infoHashHex)
		// `prev` carries the announcing peer's own state from the
		// last announce; subtract them from the swarm counts so
		// "leechers excluding myself" reads as the no_leecher
		// detector expects.
		if prev != nil && prev.Left > 0 {
			preLeechers--
		} else if prev != nil {
			preSeeders--
		}
		if preSeeders < 0 {
			preSeeders = 0
		}
		if preLeechers < 0 {
			preLeechers = 0
		}
		var prevUpdatedMs int64
		if prev != nil {
			prevUpdatedMs = prev.UpdatedAt
		}
		acFlags := anticheat.Inspect(anticheat.DefaultConfig(), anticheat.Inputs{
			UserID:          user.ID,
			TorrentID:       torrentID,
			InfoHash:        infoHashHex,
			PeerIDHex:       peerHex,
			IP:              clientIP,
			UserAgent:       userAgent,
			Event:           req.Event.String(),
			Left:            req.Left,
			DeltaUp:         deltaUp,
			DeltaDown:       deltaDown,
			PrevUpdatedAtMs: prevUpdatedMs,
			SwarmSeeders:    preSeeders,
			SwarmLeechers:   preLeechers,
		})
		if len(acFlags) > 0 {
			s.bgTasks.Add(1)
			go func(flags []anticheat.Flag) {
				defer s.bgTasks.Done()
				anticheat.Persist(ctx, s.db.Pool, flags)
			}(acFlags)
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

	// 7. event=stopped: remove peer and emit the empty-peer-list
	// response — the client just left, so they don't need a fresh
	// swarm snapshot, but they do still want the current counts.
	if req.Event == announce.EventStopped {
		_ = s.peers.Remove(ctx, infoHashHex, peerHex)
		seeders, leechers, _ := s.peers.Counts(ctx, infoHashHex)
		return AnnounceOutcome{
			Seeders:     seeders,
			Leechers:    leechers,
			Peers:       nil,
			Interval:    announceInterval,
			MinInterval: minAnnounceInterval,
		}
	}

	// 8. Upsert the peer
	ipHash := cryptohash.HashIP(clientIP, s.ipHashSecret)
	pdata := &peers.PeerData{
		PeerID:     peerHex,
		UserID:     user.ID,
		IP:         clientIP,
		IPHash:     ipHash,
		Port:       req.Port,
		Uploaded:   req.Uploaded,
		Downloaded: req.Downloaded,
		Left:       req.Left,
		IsSeeder:   req.IsSeeder(),
	}
	if err := s.peers.Set(ctx, infoHashHex, pdata); err != nil {
		slog.Error("internal error", "where", "store peer", "err", err)
		return AnnounceOutcome{Failure: "Internal tracker error"}
	}

	// 9. event=completed: bump the counter and create the HnR entry
	if req.Event == announce.EventCompleted {
		_ = s.peers.IncrementCompleted(ctx, infoHashHex)
		s.bgTasks.Add(1)
		go s.recordHnrCompletion(req.Passkey, infoHashHex)
	}

	// 10. Seeders contribute to seed-time tracking
	if req.IsSeeder() && prev != nil {
		elapsed := (time.Now().UnixMilli() - prev.UpdatedAt) / 1000
		if elapsed > 0 && elapsed < 3600 {
			s.bgTasks.Add(1)
			go s.recordSeedTime(req.Passkey, infoHashHex, int32(elapsed))
		}
	}

	// 11. Build the announce response with the current swarm state
	peerList, err := s.peers.List(ctx, infoHashHex)
	if err != nil {
		slog.Error("internal error", "where", "list peers", "err", err)
		return AnnounceOutcome{Failure: "Internal tracker error"}
	}
	seeders, leechers := 0, 0
	for _, p := range peerList {
		if p.IsSeeder {
			seeders++
		} else {
			leechers++
		}
	}
	return AnnounceOutcome{
		Seeders:     seeders,
		Leechers:    leechers,
		Peers:       peerList,
		Interval:    announceInterval,
		MinInterval: minAnnounceInterval,
	}
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
	defer s.bgTasks.Done()
	// Panic guard: any panic inside this goroutine would skip the
	// `defer hnrRelease()` below and permanently leak a semaphore
	// slot. After 8 leaked slots the entire HnR pipeline deadlocks
	// (no completion is ever recorded). Catching the panic and
	// releasing the slot keeps the tracker self-healing.
	defer func() {
		if r := recover(); r != nil {
			slog.Error("hnr completion panic", "info_hash", infoHashHex, "panic", r)
		}
	}()

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
	defer s.bgTasks.Done()
	// See `recordHnrCompletion` for the rationale — without this
	// recover() a panic here would leak the semaphore slot it's
	// about to take.
	defer func() {
		if r := recover(); r != nil {
			slog.Error("seed time panic", "info_hash", infoHashHex, "panic", r)
		}
	}()

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
// forge any IP.
//
// Header priority when TRUST_PROXY is on:
//
//  1. **`CF-Connecting-IP`** — Cloudflare's authoritative header. It
//     always carries the peer's real IP, regardless of intermediate
//     hops, Argo Tunnels, Spectrum, or any other CF-side rewrite.
//     The API tier (`apps/api/utils/rateLimit.ts`) reads the same
//     header first; keeping the tracker in lockstep means the
//     `ip_hash` analytics and the rate-limit buckets agree on who
//     the peer is.
//
//  2. **`X-Forwarded-For` (rightmost token)** — fallback for non-CF
//     deployments. An upstream proxy APPENDS the peer it observed to
//     the right of the existing list; the leftmost entry is always
//     client-supplied and trivially spoofable. Taking the rightmost
//     token guards against a malicious client sending
//     `X-Forwarded-For: 1.2.3.4` to poison the swarm view.
//
//  3. **`X-Real-IP`** — last-resort fallback for proxies that don't
//     emit XFF (rare but seen with some Traefik / HAProxy configs).
//
// All header values are validated as real IP literals so a malformed
// / garbage header just falls through to `RemoteAddr`.
func (s *Server) clientIP(r *http.Request) string {
	if trustProxy {
		if v := r.Header.Get("CF-Connecting-IP"); v != "" {
			if ip := net.ParseIP(strings.TrimSpace(v)); ip != nil {
				return ip.String()
			}
		}
		if v := r.Header.Get("X-Forwarded-For"); v != "" {
			// Walk the list right-to-left, taking the last well-formed
			// entry. Trusted proxies append, so the rightmost value is
			// the one our direct upstream observed.
			candidate := v
			if i := strings.LastIndexByte(v, ','); i >= 0 {
				candidate = v[i+1:]
			}
			if ip := net.ParseIP(strings.TrimSpace(candidate)); ip != nil {
				return ip.String()
			}
		}
		if v := r.Header.Get("X-Real-IP"); v != "" {
			if ip := net.ParseIP(strings.TrimSpace(v)); ip != nil {
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
