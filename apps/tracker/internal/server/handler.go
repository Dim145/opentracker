package server

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
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
	"github.com/florianjs/trackarr/apps/tracker/internal/stats"
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
	db    *dbpkg.DB
	redis *redis.Client
	peers *peers.Store
	bonus *bonus.Resolver
	dedup *dedup
	// stats regroupe les crédits d'octets avant de les porter à `users`.
	// Jamais nil : sans Redis il écrit directement, comme avant.
	stats        *stats.Accumulator
	ipHashSecret string
	debug        bool
	// federationSwarm: when true, ProcessAnnounce mixes peers cached from
	// partner instances (`remote_peers:{infoHash}`) into the response. Off
	// by default (TRACKER_FEDERATION_SWARM) — re-opens private swarm isolation.
	federationSwarm bool
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

	// seedTimeDropped compte les crédits de temps de seed qui n'ont PAS été
	// écrits — sémaphore saturé, erreur Postgres, panique rattrapée.
	//
	// Il existe parce que la panne qu'il mesure était indétectable : un échec
	// d'écriture n'écrivait qu'un `slog.Warn`, et le seul symptôme visible
	// était que des membres ne franchissaient jamais leurs heures exigées — un
	// mois plus tard, et attribué à autre chose. Monotone, échantillonné dans
	// le journal comme les compteurs UDP : ce qui compte est la PENTE, pas la
	// valeur.
	seedTimeDropped atomic.Uint64
	// swarmUnavailable compte les annonces servies sans essaim parce que Redis
	// ne répondait pas (voir `degradedOutcome`). Un compteur plutôt qu'une
	// ligne par annonce : une panne de Redis ne doit pas se doubler d'une
	// avalanche de journaux.
	swarmUnavailable atomic.Uint64
	// lookups answers from memory the announces that cannot succeed.
	lookups *lookupGuard
}

// New builds a Server. It does not start listening — callers wire it into
// http.Handler routes themselves so tests can use httptest directly.
// appCtx should be the process-lifecycle context (cancelled on shutdown).
// `redisKeyPrefix` must match the API's REDIS_KEY_PREFIX so the bonus
// resolver reads the same Redis snapshot the API writes.
func New(appCtx context.Context, db *dbpkg.DB, rclient *redis.Client, store *peers.Store, redisKeyPrefix, ipHashSecret string, debug, federationSwarm bool, statsFlushInterval time.Duration, statsFlushChunk int) *Server {
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
		db:              db,
		redis:           rclient,
		peers:           store,
		bonus:           bonus.New(rclient, redisKeyPrefix),
		dedup:           newDedup(rclient, redisKeyPrefix),
		lookups:         newLookupGuard(),
		stats:           stats.New(rclient, db.Q, redisKeyPrefix, statsFlushInterval, statsFlushChunk),
		ipHashSecret:    ipHashSecret,
		debug:           debug,
		federationSwarm: federationSwarm,
		appCtx:          appCtx,
		hnrSlots:        slots,
	}
}

// Routes returns the http.Handler for /announce, /scrape and a health check.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/announce", s.handleAnnounce)
	mux.HandleFunc("/scrape", s.handleScrape)
	mux.HandleFunc("/health", s.handleHealth)
	return noSniff(mux)
}

// noSniff stops a browser from guessing a type for these bodies. They are
// declared text/plain or JSON, and a bencoded failure reason or peer list read
// as HTML is what a sniffing browser could make of them. The shipped Caddyfile
// adds the header on the tracker host; an ingress in front of the chart does
// not, so the tracker sets it itself.
func noSniff(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// Stop tears the server down: stops the dedup eviction loop, then
// waits up to `bgDrainTimeout` for in-flight background tasks
// (HnR completion + seed-time recorders) to finish their pgx
// writes. Past the deadline we give up and let the process exit —
// the deferred contexts inside each worker already carry a 5 s
// timeout, so this only protects against a stuck DB.
func (s *Server) Stop() {
	s.dedup.Stop()
	// Avant le drain : ce dernier versement est ce qui empêche un
	// redéploiement de perdre une fenêtre entière de crédits, pour tous les
	// membres à la fois.
	s.stats.Stop()

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

// maxSeedTimeCredit bounds what one announce may credit as seed time: two
// announce intervals, so a client that missed one announce is not
// short-changed, while a baseline left hours ago cannot claim the whole gap.
const maxSeedTimeCredit = 2 * announceInterval * time.Second

// announceDeadline bounds one announce end to end, under the HTTP server's
// 10 s write timeout.
const announceDeadline = 5 * time.Second

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
	if req.UnknownEventRaw != "" && s.debug {
		// Clients with custom or buggy event values used to silently
		// reach the announce path as if they had sent nothing — useful
		// to know about for operator support / debugging interop.
		//
		// Derrière `s.debug`, tronqué, et l'IP hachée. La ligne était en
		// `Info`, s'exécutait AVANT la validation de la passkey, et journalisait
		// la valeur brute du client : un seul `?event=<15 Ko>` produisait près
		// de 10 Ko de journal, et `MaxHeaderBytes` (16 Ko) en était la seule
		// borne. À 500 requêtes par seconde, c'est un remplissage de disque non
		// authentifié. L'IP hachée suit la convention de `PeerData` et de
		// l'anti-triche, qui ne persistent jamais une adresse en clair.
		ev := req.UnknownEventRaw
		if len(ev) > 32 {
			ev = ev[:32] + "…"
		}
		slog.Debug("announce unknown event",
			"event", ev,
			"ip_hash", cryptohash.HashIP(clientIP, s.ipHashSecret),
		)
	}
	out := s.ProcessAnnounce(r.Context(), req, clientIP, r.UserAgent())
	if out.Failure != "" {
		writeFailure(w, out.Failure)
		return
	}

	body := buildAnnounceResponse(out.Seeders, out.Leechers, out.Interval, out.MinInterval, out.Peers, req.Compact, req.PeerID, req.NumWant)
	// Bencode, served as text/plain with nosniff (noSniff): not markup.
	// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter
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

	// A deadline for everything below, connection-pool waits included. Over
	// HTTP the request context has none, and over UDP the processor gets the
	// process's: a query plan gone wrong held a pooled connection with nothing
	// able to cancel it, and twenty such announces froze every other one in
	// `Acquire`. Background writes take `s.appCtx`, not this.
	ctx, cancel := context.WithTimeout(ctx, announceDeadline)
	defer cancel()

	// 0. Announces that cannot succeed, answered without a lookup: an address
	// that has used up its failures for the minute, or a passkey of a shape
	// the site never mints. See lookupGuard.
	now := time.Now()
	if s.lookups.blocked(clientIP, now) {
		return AnnounceOutcome{Failure: "Too many invalid requests, retry later"}
	}
	if !plausiblePasskey(req.Passkey) {
		s.lookups.fail(clientIP, now)
		return AnnounceOutcome{Failure: "Invalid passkey"}
	}

	// 1. Resolve & validate the user
	user, err := s.db.UserByPasskey(ctx, req.Passkey)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.lookups.fail(clientIP, now)
			return AnnounceOutcome{Failure: "Invalid passkey"}
		}
		slog.Error("internal error", "where", "find user", "err", err)
		return AnnounceOutcome{Failure: "Internal tracker error"}
	}
	if user.IsBanned {
		// Lazy unban: when a timed ban has elapsed, clear the flag
		// inline so the announce can proceed even if the 5-minute
		// `ban-expiry` cron hasn't ticked yet. Branch is cold —
		// only banned users pay the extra round-trip — so the
		// happy path stays at one query.
		var bannedUntil *time.Time
		err := s.db.Pool.QueryRow(
			ctx,
			`SELECT banned_until FROM users WHERE id = $1`,
			user.ID,
		).Scan(&bannedUntil)
		if err != nil || bannedUntil == nil || !bannedUntil.Before(time.Now()) {
			return AnnounceOutcome{Failure: "User is banned"}
		}
		if _, err := s.db.Pool.Exec(
			ctx,
			`UPDATE users SET is_banned = false WHERE id = $1`,
			user.ID,
		); err != nil {
			slog.Error("internal error", "where", "lazy unban", "err", err)
			return AnnounceOutcome{Failure: "Internal tracker error"}
		}
		// The row just changed under us. Nothing cached it (banned users
		// never are), but dropping the key is what makes that guarantee
		// hold if the rule above ever loosens.
		s.db.InvalidatePasskey(ctx, req.Passkey)
		// fall through — the user is effectively unbanned now;
		// the cron will (idempotently) fire `account_unbanned` on
		// its next sweep.
	}

	// 1b. IP ban — the api enforces banned_ips at the web/login tier; honour
	// the same list here so an operator-banned IP can't keep leeching via
	// the swarm with any valid passkey (finding L8). Cached (60s) and
	// fail-open, so a DB hiccup never blocks a legitimate announce.
	if banned, err := s.db.IsIpBanned(ctx, clientIP); err == nil && banned {
		return AnnounceOutcome{Failure: "Access denied"}
	}

	// 2. Ratio check (only when leeching: left > 0) — and not while a
	// site-wide event counts no download at all. Under a freeleech nothing a
	// member downloads moves their ratio, so refusing them for it held the
	// members the event was meant for out of it.
	if req.Left > 0 && s.bonus.Get(ctx).Download != 0 {
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
	//
	// The announced hash is not necessarily the swarm key. A hybrid torrent
	// (BEP 52) has a v1 and a v2 infohash and a v2-capable client announces
	// under both; the resolver maps either onto the row and hands back the
	// CANONICAL v1 hash. Reassigning `infoHashHex` to it here is what puts both
	// halves of that swarm under one Redis key — every keyed operation below
	// (dedup window, peer set, completed counter, seed time, anti-cheat) reads
	// this variable and therefore agrees. See db.ResolveAnnouncedTorrent.
	resolved, err := s.db.ResolveAnnouncedTorrent(ctx, infoHashHex)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Not counted by the lookup guard: the passkey was valid, so this is
			// a member's client still announcing a torrent the site removed.
			return AnnounceOutcome{Failure: "Torrent not found or inactive"}
		}
		slog.Error("internal error", "where", "find torrent", "err", err)
		return AnnounceOutcome{Failure: "Internal tracker error"}
	}
	torrentID := resolved.ID
	if resolved.SwarmKey != infoHashHex {
		// A v2 announce. Logged at debug rather than info: it is entirely
		// normal, happens every interval for every v2-capable peer, and the
		// only reason to want it is diagnosing a swarm that looks split.
		slog.Debug("v2 announce folded into the v1 swarm",
			"announced", infoHashHex, "swarm", resolved.SwarmKey)
		infoHashHex = resolved.SwarmKey
	}

	// 4. Dedup window — skip if same {hash,peer,event} fired within 2 seconds.
	//
	// The member is part of every key below. A peer_id is public — any client
	// in the swarm reads it in the handshake — so a key made of it alone let a
	// stranger announcing under someone else's peer_id every second hold that
	// member's window shut, and their announces with it.
	peerHex := hexBytes(req.PeerID[:])
	peerKey := peerHex + ":" + user.ID
	dedupKey := infoHashHex + ":" + peerKey + ":" + req.Event.String()
	if !s.dedup.CheckAndMark(ctx, dedupKey) {
		seeders, leechers, _ := s.peers.Counts(ctx, infoHashHex)
		return AnnounceOutcome{
			Seeders:     seeders,
			Leechers:    leechers,
			Peers:       nil,
			Interval:    announceInterval,
			MinInterval: minAnnounceInterval,
		}
	}

	// 5. Calculate stats deltas vs the previous announce.
	//
	// A delta is ONLY ever credited as the difference between two
	// announces we actually observed (a durable-enough Redis baseline
	// from the previous announce). We never trust a client-declared
	// cumulative counter as a standalone delta.
	//
	// Why: `event=stopped` deletes the peer from Redis (step 7), which
	// resets `prev` to nil. An earlier version trusted `req.Uploaded`
	// as the full delta on the first-announce `started` path, so a
	// client could loop `started(uploaded=1TiB)` → `stopped` →
	// `started(uploaded=1TiB)` … and fabricate unlimited upload credit
	// (the 1 TiB cap below is per-announce, so it did not bound the
	// loop; and the velocity anti-cheat heuristic is skipped whenever
	// prev==nil). See security finding C2.
	//
	// Cost of the safe behaviour: when a peer's baseline is missing
	// (explicit client restart, or a Redis gap > peerTTL) the first
	// announce credits 0 and merely re-establishes the baseline (the
	// peer is stored in step 8 with its current counters); subsequent
	// announces credit the genuine increments. A restart therefore
	// forfeits at most one announce-interval of credit — identical to
	// the long-standing TTL-expiry behaviour, and the only direction
	// that cannot be replayed.
	//
	// The entry is this member's own: another member announcing under the same
	// peer_id gets a field of its own, and neither can reach the other's
	// baseline (see peers.Slot).
	prev, slot, _ := s.peers.Slot(ctx, infoHashHex, peerHex, user.ID)

	var deltaUp, deltaDown int64
	if prev != nil {
		if d := req.Uploaded - prev.Uploaded; d > 0 {
			deltaUp = d
		}
		if d := req.Downloaded - prev.Downloaded; d > 0 {
			deltaDown = d
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
		// Drop the flags a concurrent announce already raised. Two
		// announces for the same peer that differ in event both run the
		// detectors, and behind a load balancer they run in different
		// processes — so the same evidence produced two rows in the
		// moderation queue. Only `no_leecher` was protected, by the
		// partial unique index it upserts against; every other kind was
		// a plain INSERT.
		//
		// Keyed per KIND and per MEMBER, over the minimum announce interval.
		// It was per peer over 2 s: two announces milliseconds apart made
		// one flag, but a client announcing every few seconds — or rotating
		// its peer_id — added a row each time, and a single cheater could
		// bury the moderation queue. No honest client announces faster than
		// `minAnnounceInterval`, so evidence arriving at a normal cadence is
		// still recorded every time.
		//
		// The filter lives here rather than in the anticheat package so
		// that package stays free of Redis and remains a pure detector.
		if len(acFlags) > 0 {
			fresh := acFlags[:0]
			for _, f := range acFlags {
				if s.dedup.CheckAndMarkFor(
					ctx, infoHashHex+":"+user.ID+":acflag:"+f.Kind,
					time.Duration(minAnnounceInterval)*time.Second,
				) {
					fresh = append(fresh, f)
				}
			}
			acFlags = fresh
		}
		if len(acFlags) > 0 {
			s.bgTasks.Add(1)
			go func(flags []anticheat.Flag) {
				defer s.bgTasks.Done()
				// recover() so a panic still releases the WaitGroup
				// slot (otherwise graceful shutdown's bgTasks.Wait()
				// would hang). Mirrors recordHnrCompletion/recordSeedTime.
				defer func() {
					if r := recover(); r != nil {
						slog.Error("anticheat persist panic", "recover", r)
					}
				}()
				// Derive the DB context from the server lifetime, NOT the
				// request ctx: r.Context() is cancelled the instant the
				// announce response is written, so the detached write
				// almost always raced into `context canceled` and the
				// flag was silently dropped — quietly starving the very
				// moderation queue this subsystem feeds (finding M9).
				pctx, cancel := context.WithTimeout(s.appCtx, 5*time.Second)
				defer cancel()
				anticheat.Persist(pctx, s.db.Pool, flags)
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
	// Per-second ceiling for credited bytes, applied as rate × elapsed
	// below. 1 GiB/s (~8 Gbit/s) sits above any normal seedbox link, so
	// honest seeders are never clamped; it exists purely to bound
	// fabricated deltas (finding H1). Bump this in code if you genuinely
	// run faster links.
	const maxCreditBytesPerSec int64 = 1 << 30 // 1 GiB/s
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

	// 5a-bis. Rate-clamp the credited delta to maxCreditBytesPerSec ×
	// (seconds since this peer's previous announce). The per-announce
	// cap above only bounds a SINGLE announce, but nothing on the wire
	// enforces a minimum announce interval — a client could announce
	// every ~2 s claiming +1 TiB each time and mint effectively unlimited
	// upload credit, defeating ratio gating and ratio-derived roles
	// (finding H1). Because consecutive clamps cover adjacent time
	// windows, the integral of credited bytes is bounded by the rate ×
	// wall-clock no matter how fast — or under how many rotated peer_ids —
	// the client announces. Runs AFTER anticheat.Inspect so the detector
	// still sees the raw client claim.
	if prev != nil && (deltaUp > 0 || deltaDown > 0) {
		elapsedMs := time.Now().UnixMilli() - prev.UpdatedAt
		if elapsedMs < 0 {
			elapsedMs = 0 // non-monotonic wall clock / skew
		}
		// Integer seconds. Sub-second gaps clamp to 0, which is safe: the
		// creditKey dedup (step 6) already blocks crediting more than once
		// per 2 s per (hash, peer), and genuine bytes are picked up on the
		// next announce as the baseline rolls forward.
		maxByElapsed := maxCreditBytesPerSec * (elapsedMs / 1000)
		if maxByElapsed < 0 || maxByElapsed > maxDeltaPerAnnounce {
			// Overflow on absurd skew, or a gap long enough that the
			// per-announce cap is the tighter bound.
			maxByElapsed = maxDeltaPerAnnounce
		}
		if deltaUp > maxByElapsed {
			slog.Warn("clamping upload delta to rate ceiling",
				"info_hash", infoHashHex,
				"peer_id", peerHex,
				"claimed", deltaUp,
				"allowed", maxByElapsed,
				"elapsed_ms", elapsedMs,
			)
			deltaUp = maxByElapsed
		}
		if deltaDown > maxByElapsed {
			deltaDown = maxByElapsed
		}
	}

	// 5a-ter. Le budget du COMPTE, après le clamp par pair.
	//
	// Le clamp ci-dessus borne un essaim vu par un peer_id ; son commentaire
	// dit « no matter how many rotated peer_ids », ce qui est vrai en rotation
	// séquentielle et faux en CONCURRENCE — les fenêtres de deux peer_id
	// différents se chevauchent au lieu d'être adjacentes. Cent peer_id
	// parallèles franchissaient donc chacun leur propre plafond, pour un
	// agrégat de cent fois le débit autorisé.
	//
	// Ce seau borne l'axe sur lequel l'économie est libellée : le compte. Il
	// échoue OUVERT sur une erreur Redis, comme tous les caches de ce chemin —
	// refuser un crédit légitime parce que le cache a hoqueté est le mauvais
	// sens de l'erreur, et sans Redis il n'y a de toute façon pas de `prev`
	// donc pas de delta à créditer.
	/*
	 * La déduplication décide AVANT que le seau ne soit vidé.
	 *
	 * `CheckAndMark` était consulté plus bas, une fois les jetons déjà retirés.
	 * Un client à double pile — le cas même pour lequel la déduplication
	 * existe — brûlait donc son budget deux fois pour un seul crédit, et les
	 * jetons ne sont jamais rendus. Le sens de l'erreur était favorable (le
	 * membre est sous-crédité, jamais sur-crédité) et la réserve d'une minute
	 * l'absorbe pour un seedeur honnête, mais l'ordre était inversé.
	 *
	 * Le marquage reste au même instant qu'avant par rapport à l'écriture :
	 * c'est la même requête qui marque et qui crédite. Ce qui change, c'est
	 * qu'un delta qui ne sera PAS porté au compte ne coûte plus de jetons.
	 *
	 * L'écrêtage garde sa place d'origine — avant les multiplicateurs de bonus,
	 * qui s'appliquent ensuite au delta déjà borné.
	 */
	creditKey := infoHashHex + ":" + peerKey + ":credit"
	bookCredit := (deltaUp > 0 || deltaDown > 0) &&
		s.dedup.CheckAndMark(ctx, creditKey)

	if bookCredit {
		want := deltaUp + deltaDown
		if granted, err := s.peers.TakeCreditBudget(
			ctx, user.ID, want, maxCreditBytesPerSec,
		); err == nil && granted < want {
			// L'allocation va d'abord à l'upload : c'est l'axe qu'il vaut la
			// peine de fabriquer, et rogner le download ne profite qu'au membre.
			if granted < deltaUp {
				deltaUp, deltaDown = granted, 0
			} else {
				deltaDown = granted - deltaUp
			}
			slog.Warn("clamping delta to the per-user budget",
				"user_id", user.ID,
				"info_hash", infoHashHex,
				"claimed", want,
				"granted", granted,
			)
		}
	}

	// 5b. Apply the bonus multipliers before persisting.
	//
	// Two sources now. The site-wide event (Freeleech / Silverleech / custom)
	// comes from a 30 s in-memory cache backed by Redis, so it is a near-zero
	// cost call when nothing is running. The per-torrent buff arrived on the
	// row we already had to read in step 3, so it costs nothing at all — and
	// the SQL has already neutralised it if it lapsed, which is why there is no
	// clock here.
	//
	// `Best` gives the member the better of the two on each axis rather than
	// the product; see the note on it for why the product is the wrong answer.
	// With no event and no buff both are identity and the deltas are unchanged.
	//
	// The 1 TiB cap above still guarantees the multiplication cannot overflow
	// int64 (1 TiB × 1000 / 100 = 10 TiB ≪ 9.2 EiB), and `Best` cannot raise a
	// multiplier above the larger of its two inputs, so it does not widen that.
	mults := bonus.Best(s.bonus.Get(ctx), resolved.Multipliers)
	deltaUp, deltaDown = mults.Apply(deltaUp, deltaDown)

	// 6. Persist user stats deltas (best-effort: log but don't reject).
	// We bump both the global counter (`users.uploaded/downloaded`) and
	// the per-torrent counter inside hnr_tracking. The latter creates a
	// tracking row on the first non-zero delta so the Downloads page in
	// the web UI can show a torrent before the user has completed it.
	//
	// Credit-dedup: the main dedup key (step 4) includes the event, so
	// two concurrent announces that share {hash,peer} but differ in
	// event (e.g. `started` + `update`) BOTH pass it, both read the
	// same `prev` baseline, and would each credit the same delta —
	// an N× over-credit (finding M5). Gate the credit itself on an
	// event-independent key so the byte delta is booked at most once
	// per (hash,peer) per 2 s window. CheckAndMark is mutex-guarded AND
	// Redis-backed, so exactly one of a concurrent pair wins whether the
	// two land on the same process or on two instances behind a load
	// balancer. The per-event dedup above still lets distinct events run
	// their own side effects (completed counter, stopped removal).
	if bookCredit {
		// Par l'ID : une passkey rotée entre la résolution (cache de 60 s) et
		// cette écriture faisait toucher zéro ligne, et le crédit disparaissait
		// sans un mot.
		//
		// Le delta passe désormais par l'accumulateur, qui le regroupe avec
		// ceux des autres annonces du même membre avant de les verser en une
		// écriture. Un membre qui seede 70 torrents mettait à jour sa propre
		// ligne 70 fois par intervalle ; c'est ce gaspillage-là que le
		// regroupement supprime. Voir internal/stats pour les mesures, et
		// notamment pourquoi le versement se fait par petites tranches.
		//
		// Sans Redis — les tests — l'accumulateur écrit immédiatement, et ce
		// chemin est exactement celui d'avant.
		if err := s.stats.Add(ctx, user.ID, deltaUp, deltaDown); err != nil {
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
		_ = s.peers.Remove(ctx, infoHashHex, slot)
		seeders, leechers, _ := s.peers.Counts(ctx, infoHashHex)
		return AnnounceOutcome{
			Seeders:     seeders,
			Leechers:    leechers,
			Peers:       nil,
			Interval:    announceInterval,
			MinInterval: minAnnounceInterval,
		}
	}

	// 8. Upsert the peer — after making room for it if this member already
	// holds as many live entries on this torrent as one member may.
	if prev == nil {
		s.capMemberPeers(ctx, infoHashHex, user.ID)
	}
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
		Field:      slot,
	}
	if err := s.peers.Set(ctx, infoHashHex, pdata); err != nil {
		// Redis is down: the swarm can be neither stored nor read, but the rest
		// of the announce still runs — the credit already fell back to a direct
		// write — and step 11 answers in degraded mode.
		s.noteSwarmUnavailable("store peer", err)
	}

	// 9. event=completed: bump the counter and create the HnR entry.
	// Count only the FIRST completion per (user, torrent) — a client
	// replaying event=completed (or rotating peer_id) must not inflate the
	// public snatch counter (finding L12). Fail-open: a Redis error credits
	// (preserving prior behaviour) rather than silently dropping a snatch.
	if req.Event == announce.EventCompleted {
		first, markErr := s.peers.MarkFirstCompletion(ctx, torrentID, user.ID)
		if markErr != nil || first {
			_ = s.peers.IncrementCompleted(ctx, infoHashHex)
		}
		s.bgTasks.Add(1)
		go s.recordHnrCompletion(user.ID, torrentID, infoHashHex)
	}

	// 10. Seeders contribute to seed-time tracking.
	//
	// A BEP 21 partial seed is excluded by `IsSeeder()` and that is the
	// intended reading: hit-and-run asks a member to seed what they took, and
	// somebody holding a deselected subset cannot satisfy it however long they
	// stay connected. They keep serving the pieces they do have — they are
	// still in the swarm — they simply do not bank seed time towards a
	// requirement they cannot meet.
	if req.IsSeeder() && prev != nil {
		/*
		 * Le temps crédité est réservé par (torrent, UTILISATEUR), pas par peer.
		 *
		 * `AddSeedTime` additionne dans UNE ligne `hnr_tracking` par
		 * (user, torrent) : cent peer_id concurrents sur le même torrent
		 * versaient chacun le même intervalle de temps réel dans la même ligne,
		 * et les 24 h exigées se soldaient en un quart d'heure. Le premier
		 * correctif bornait chaque crédit à `minAnnounceInterval` sous une
		 * fenêtre de même durée — ce qui ne créditait que la moitié du temps
		 * d'un seedeur qui réannonce toutes les `announceInterval`.
		 *
		 * `ClaimSeedTime` garde la marque jusqu'où le compte est crédité :
		 * chaque annonce prend l'intervalle qui la sépare de la marque (ou de
		 * sa propre ligne de base, si elle est plus récente), puis l'avance.
		 * Disjoints quel que soit le nombre de peer_id ou de réplicas, donc
		 * jamais plus que le temps réel ; entiers pour un seedeur honnête.
		 * Concurrent announces with distinct events (finding M7) are covered
		 * the same way: the second one finds the mark already at now.
		 *
		 * Le plafond borne ce qu'une ligne de base ancienne peut réclamer : un
		 * client resté muet plus de deux intervalles n'a sans doute pas seedé
		 * tout ce temps. Une erreur Redis ne crédite rien.
		 */
		now := time.Now()
		if secs, err := s.peers.ClaimSeedTime(
			ctx, torrentID, user.ID, now, time.UnixMilli(prev.UpdatedAt), maxSeedTimeCredit,
		); err == nil && secs > 0 {
			s.bgTasks.Add(1)
			go s.recordSeedTime(user.ID, torrentID, infoHashHex, int32(secs)) // #nosec G115 -- capped at maxSeedTimeCredit (two intervals) by ClaimSeedTime
		} else if err != nil {
			slog.Warn("claim seed time", "info_hash", infoHashHex, "err", err)
		}
	}

	// 11. Build the announce response with the current swarm state
	return s.swarmOutcome(ctx, infoHashHex, req.IsSeeder())
}

// swarmOutcome is the reply to an announce that is not a stop: the current
// swarm, as much of it as this client should be told about.
func (s *Server) swarmOutcome(ctx context.Context, infoHashHex string, announcerIsSeeder bool) AnnounceOutcome {
	peerList, err := s.peers.List(ctx, infoHashHex)
	if err != nil {
		s.noteSwarmUnavailable("list peers", err)
		return degradedOutcome()
	}
	// 11b. Federation cross-announce (Phase 4): mix in peers cached from
	// partner instances for this torrent. Off unless TRACKER_FEDERATION_SWARM.
	// Best-effort — a cache miss or error never fails the announce.
	if s.federationSwarm {
		if remote, rerr := s.peers.ListRemote(ctx, infoHashHex); rerr == nil && len(remote) > 0 {
			peerList = mergePeers(peerList, remote)
		}
	}
	seeders, leechers := 0, 0
	for _, p := range peerList {
		if p.IsSeeder {
			seeders++
		} else {
			leechers++
		}
	}
	// A seeder has nothing to fetch from another seeder, so it is only told
	// about leechers — what every tracker does, and it closes the cheap half
	// of the `left=0` bypass: the ratio gate (step 2) only looks at members
	// still downloading, so one under the minimum ratio who announces as a
	// seeder used to be handed every seeder of the swarm to download from. The
	// counts above still describe the whole swarm.
	return AnnounceOutcome{
		Seeders:     seeders,
		Leechers:    leechers,
		Peers:       peersForAnnouncer(peerList, announcerIsSeeder),
		Interval:    announceInterval,
		MinInterval: minAnnounceInterval,
	}
}

// maxPeersPerMember is how many live entries one member may hold on one
// torrent: a seedbox, a home client, a laptop, with room for a restart or two.
const maxPeersPerMember = 5

// capMemberPeers evicts this member's oldest live entries on the torrent until
// a new one fits under `maxPeersPerMember`.
//
// Nothing bounded them. One passkey announcing random peer_ids grew the
// swarm's hash without end — each write pushed its 24 h TTL further — and every
// announce on that torrent then read the whole bloated hash, while other
// clients were handed peers that did not exist. Evicting rather than refusing,
// because the usual way to cross the line is innocent: qBittorrent picks a new
// peer_id every session, and a client restarted a few times in an hour leaves
// its previous entries live behind it. The oldest are the ones it left.
//
// Best effort: called only for a peer_id the swarm has not seen, so the swarm
// read it costs is paid once per client session, and an error skips the cap.
func (s *Server) capMemberPeers(ctx context.Context, infoHashHex, userID string) {
	list, err := s.peers.List(ctx, infoHashHex)
	if err != nil {
		return
	}
	mine := make([]*peers.PeerData, 0, maxPeersPerMember)
	for _, p := range list {
		if p.UserID == userID {
			mine = append(mine, p)
		}
	}
	if len(mine) < maxPeersPerMember {
		return
	}
	sort.Slice(mine, func(i, j int) bool { return mine[i].UpdatedAt < mine[j].UpdatedAt })
	for _, p := range mine[:len(mine)-maxPeersPerMember+1] {
		_ = s.peers.Remove(ctx, infoHashHex, p.Field)
	}
}

// degradedInterval is how soon a client answered without a swarm comes back:
// short, so announces resume within minutes of Redis returning.
const degradedInterval = 300

// degradedOutcome answers an announce while Redis is down. Refusing it — what
// the tracker did — turned a Redis outage into a tracker outage: every client
// showed the torrent's tracker as failing and backed off on its own schedule,
// although Postgres could still authenticate them and the credit had already
// fallen back to a direct write. An empty peer list and a short interval keep
// the clients' existing connections going and bring them back soon.
func degradedOutcome() AnnounceOutcome {
	return AnnounceOutcome{Interval: degradedInterval, MinInterval: 60}
}

func (s *Server) noteSwarmUnavailable(where string, err error) {
	if n := s.swarmUnavailable.Add(1); n%1_000 == 1 {
		slog.Error("swarm store unavailable, announces answered in degraded mode",
			"where", where, "count", n, "err", err)
	}
}

// mergePeers appends remote (partner-instance) peers to the local set,
// de-duplicating by ip:port so a peer present in both swarms isn't listed
// twice. Local peers keep priority (kept first); remote ones fill in.
func mergePeers(local, remote []*peers.PeerData) []*peers.PeerData {
	type key struct {
		ip   string
		port uint16
	}
	seen := make(map[key]struct{}, len(local)+len(remote))
	for _, p := range local {
		seen[key{p.IP, p.Port}] = struct{}{}
	}
	for _, p := range remote {
		if p == nil || p.IP == "" {
			continue
		}
		k := key{p.IP, p.Port}
		if _, ok := seen[k]; ok {
			continue
		}
		seen[k] = struct{}{}
		local = append(local, p)
	}
	return local
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

// Les identifiants sont passés, pas la passkey.
//
// Les deux écritures relançaient `FindUserAndTorrentByPasskeyAndHash` — une
// jointure croisée `users × torrents` — alors que l'appelant tenait déjà
// `user.ID` et l'identifiant du torrent. C'est exactement le défaut que
// `IncrementUserStats` documente avoir corrigé en passant par l'ID : une
// passkey rotée entre la résolution (cache de 60 s) et cette écriture ne
// touche AUCUNE ligne, et le crédit disparaît sans un mot. Coût annexe évité :
// une requête Postgres par annonce complétée et par crédit de temps de seed.
func (s *Server) recordHnrCompletion(userID, torrentID, infoHashHex string) {
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

	id, err := dbpkg.NewID()
	if err != nil {
		slog.Warn("hnr id generation", "info_hash", infoHashHex, "err", err)
		return
	}
	err = s.db.Q.CreateHnrEntry(ctx, queries.CreateHnrEntryParams{
		ID:               id,
		UserID:           userID,
		TorrentID:        torrentID,
		RequiredSeedTime: required,
	})
	if err != nil {
		slog.Warn("create hnr entry", "info_hash", infoHashHex, "err", err)
	}
}

// Mêmes raisons que `recordHnrCompletion` : par les identifiants.
//
// L'intervalle est déjà réservé quand cette fonction tourne : `ClaimSeedTime`
// a avancé la marque du compte. Si l'écriture n'a pas lieu — sémaphore saturé
// pendant 5 s, erreur Postgres, panique rattrapée —, cet intervalle-là est
// perdu, et l'annonce suivante crédite le sien normalement, depuis la marque.
// Elle n'est pas reculée pour autant : entre-temps, un autre peer_id du même
// compte a pu l'avancer à son tour, et la reculer lui ferait créditer deux fois
// le même temps. Les pertes sont comptées dans `seedTimeDropped`.
func (s *Server) recordSeedTime(userID, torrentID, infoHashHex string, secondsToAdd int32) {
	defer s.bgTasks.Done()

	credited := false
	// Enregistré AVANT le `recover` ci-dessous, donc exécuté APRÈS lui : les
	// defer se déroulent en ordre inverse, et une panique est comptée comme les
	// autres pertes.
	defer func() {
		if credited {
			return
		}
		if n := s.seedTimeDropped.Add(1); n%1_000 == 1 {
			slog.Warn("seed time credits dropped",
				"count", n,
				"info_hash", infoHashHex,
				"seconds", secondsToAdd)
		}
	}()

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

	err := s.db.Q.AddSeedTime(ctx, queries.AddSeedTimeParams{
		SeedTime:  secondsToAdd,
		UserID:    userID,
		TorrentID: torrentID,
	})
	if err != nil {
		slog.Warn("update seed time",
			"info_hash", infoHashHex,
			"seconds", secondsToAdd,
			"err", err)
		return
	}
	credited = true
}

// ----------------------------------------------------------------------------
// /scrape
// ----------------------------------------------------------------------------

// MaxScrapeResolves bounds how many v2 lookups one scrape may trigger.
//
// A scrape carries up to 64 hashes and, historically, cost zero database
// queries: each hash was read straight out of Redis. Resolving every hash
// would turn one packet into 64 queries, which is a denial-of-service handed
// out for free. Resolving none would leave a v2 client's scrape permanently
// answering zero, since the swarm now lives under the canonical key.
//
// So only hashes Redis has never heard of are resolved, and only this many per
// request. Past the budget the answer is what it was before this existed —
// zeroes — never something worse.
//
// Exported so the UDP transport shares the same ceiling.
const MaxScrapeResolves = 8

// ScrapeStats answers one hash of a scrape, folding the BEP 52 second swarm in.
//
// `resolveBudget` is decremented on each database lookup and is shared across
// one scrape request; pass a pointer to a single counter for the whole batch.
// Exported because the UDP transport has its own scrape framing but needs the
// same answer — the two must not drift.
func (s *Server) ScrapeStats(
	ctx context.Context,
	announcedHex string,
	resolveBudget *int,
) (seeders, leechers int, completed int64) {
	seeders, leechers, _ = s.peers.Counts(ctx, announcedHex)
	completed, _ = s.peers.CompletedCount(ctx, announcedHex)

	// All zero is the only case worth a query, and it is ambiguous: a dead v1
	// torrent looks exactly like a live v2 one scraped under the wrong key.
	// The lookup is what tells them apart, and a dead torrent pays one index
	// probe for it.
	if seeders != 0 || leechers != 0 || completed != 0 {
		return seeders, leechers, completed
	}
	if resolveBudget == nil || *resolveBudget <= 0 {
		return seeders, leechers, completed
	}

	// A hash we have already failed to resolve costs nothing to fail again.
	//
	// /scrape takes no passkey — by protocol — so before this the endpoint that
	// used to cost zero database work became two index probes per unknown hash,
	// eight hashes per request, from anybody on the internet. The connection
	// pool is shared with the announce path, so a few thousand requests a second
	// of random hashes stopped the tracker answering for everyone.
	//
	// The negative answer is the cheap half: it is stable (a hash this site does
	// not have does not start existing), it is what a flood is made of, and it
	// lives in Redis, which is already on this path for the peer counts above.
	if s.peers.ResolveMissCached(ctx, announcedHex) {
		return seeders, leechers, completed
	}

	*resolveBudget--

	resolved, err := s.db.ResolveAnnouncedTorrent(ctx, announcedHex)
	if err != nil || resolved.SwarmKey == announcedHex {
		// Unknown, or a v1 hash that really has no peers. Either way the
		// zeroes above are the honest answer — and worth remembering, so the
		// next probe for the same hash does not pay for the same lookup.
		s.peers.RememberResolveMiss(ctx, announcedHex)
		return seeders, leechers, completed
	}
	seeders, leechers, _ = s.peers.Counts(ctx, resolved.SwarmKey)
	completed, _ = s.peers.CompletedCount(ctx, resolved.SwarmKey)
	return seeders, leechers, completed
}

func (s *Server) handleScrape(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")

	/*
	 * La passkey, exigée. BEP 48 ne la demande pas ; un tracker privé, si.
	 *
	 * Sans elle, `curl 'https://tracker.example/scrape?info_hash=…'` avec le
	 * hash d'un titre connu confirmait sa présence sur le site ET sa
	 * popularité, sans compte. Répété sur une liste publique de hashes, cela
	 * reconstitue une part du catalogue — y compris ce qui attend une
	 * modération ou ce qui est classé adulte, puisque les compteurs viennent
	 * de Redis. Sur un site dont l'invitation est la porte, c'est la même
	 * surface que le catalogue lui-même.
	 *
	 * Le commentaire du chemin UDP (« safe to expose publicly, just like every
	 * other public BT tracker does ») raisonne pour un tracker PUBLIC.
	 *
	 * Aucun client n'est cassé : l'URL de scrape se dérive de celle d'annonce
	 * en remplaçant le dernier segment, la chaîne de requête comprise — c'est
	 * la convention de BEP 48, et c'est déjà ainsi que la passkey arrive sur
	 * `/announce` en HTTP.
	 */
	passkey := r.URL.Query().Get("passkey")
	if passkey == "" {
		writeFailure(w, "Passkey required")
		return
	}
	// The announce's lookup guard, here too: a scrape costs the same passkey
	// query, and a scanner turned away from /announce would come here instead.
	clientIP, now := s.clientIP(r), time.Now()
	if s.lookups.blocked(clientIP, now) {
		writeFailure(w, "Too many invalid requests, retry later")
		return
	}
	if !plausiblePasskey(passkey) {
		s.lookups.fail(clientIP, now)
		writeFailure(w, "Invalid passkey")
		return
	}
	if _, err := s.db.UserByPasskey(r.Context(), passkey); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			s.lookups.fail(clientIP, now)
		}
		// Le même message dans les deux cas : une passkey absente et une
		// passkey invalide ne se distinguent pas depuis l'extérieur.
		writeFailure(w, "Invalid passkey")
		return
	}

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
	// One budget for the whole batch — see MaxScrapeResolves.
	resolveBudget := MaxScrapeResolves
	for _, h := range hashes {
		if len(h) != announce.InfoHashLen {
			continue
		}
		var raw [announce.InfoHashLen]byte
		copy(raw[:], h)
		hex := hexBytes(raw[:])

		seeders, leechers, completed := s.ScrapeStats(ctx, hex, &resolveBudget)
		stats = append(stats, ScrapeStat{
			// Echoed back as announced, not as resolved: the client asked
			// about this hash and matches the reply to it.
			InfoHashRaw: raw,
			Seeders:     seeders,
			Leechers:    leechers,
			Completed:   completed,
		})
	}
	// Bencode, served as text/plain with nosniff (noSniff): not markup.
	// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter
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

	// L'en-tête AVANT le statut : `WriteHeader` fige la carte d'en-têtes, donc
	// le `Content-Type` posé après était purement et simplement ignoré sur le
	// chemin dégradé.
	w.Header().Set("Content-Type", "application/json")
	// Only Postgres makes the tracker unable to answer: without Redis it still
	// authenticates and credits, and announces get the degraded reply. A 503
	// here pulled every replica out of the Service on a Redis outage — no
	// announce answered at all, which is what degraded mode exists to avoid.
	status := "healthy"
	if !dbOK {
		status = "unhealthy"
		w.WriteHeader(http.StatusServiceUnavailable)
	} else if !redisOK {
		status = "degraded"
	}
	body := `{"status":"` + status + `","db":` + boolStr(dbOK) + `,"redis":` + boolStr(redisOK) + `}`
	// Fixed JSON built from two booleans: nothing from the request.
	// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter
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

// trustCFConnectingIP gates the CF-Connecting-IP header specifically. It is
// authoritative ONLY when the stack actually sits behind Cloudflare; our
// reverse proxy overwrites X-Real-IP / X-Forwarded-For with the real peer
// but does not set CF-Connecting-IP, so trusting it unconditionally let a
// client forge its swarm IP / ip_hash and (in lockstep with the API) bypass
// IP bans + rate limits (finding H2). Off by default; mirrors
// TRUST_CF_CONNECTING_IP in apps/api.
var trustCFConnectingIP = false

// SetTrustProxy is called once at startup based on TRUST_PROXY env.
func SetTrustProxy(b bool) { trustProxy = b }

// SetTrustCFConnectingIP is called once at startup based on the
// TRUST_CF_CONNECTING_IP env. Only enable behind Cloudflare with ingress
// locked to Cloudflare's published IP ranges.
func SetTrustCFConnectingIP(b bool) { trustCFConnectingIP = b }

// clientIP extracts the announcing peer's IP. We only honor proxy headers
// when explicitly enabled, otherwise an attacker behind a proxy could
// forge any IP.
//
// Header priority when TRUST_PROXY is on:
//
//  1. **`CF-Connecting-IP`** — Cloudflare's authoritative header, but
//     ONLY consulted when TRUST_CF_CONNECTING_IP is also on. It is
//     authoritative solely behind Cloudflare; on any other edge our
//     reverse proxy does not set it, so a client could forge it. When
//     enabled the API tier reads the same header first, keeping the
//     `ip_hash` analytics and rate-limit buckets in lockstep. When
//     disabled (the default) it is ignored entirely (finding H2).
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
		if trustCFConnectingIP {
			if v := r.Header.Get("CF-Connecting-IP"); v != "" {
				if ip := net.ParseIP(strings.TrimSpace(v)); ip != nil {
					return ip.String()
				}
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
	// Bencode, served as text/plain with nosniff (noSniff): not markup.
	// nosemgrep: go.lang.security.audit.xss.no-direct-write-to-responsewriter.no-direct-write-to-responsewriter
	_, _ = w.Write(bencode.FailureResponse(reason)) // #nosec G705 -- bencode in text/plain with nosniff
}
