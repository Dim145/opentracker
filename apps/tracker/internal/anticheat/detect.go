// Package anticheat inspects each announce for signatures that look
// like a ratio-cheating client (RatioMaster, rustatio, …) and writes
// flags to `anticheat_flags` for the moderation team to triage.
//
// Nothing here ever modifies user state or rejects an announce — the
// detector is *informational*. The /mod/anti-cheat page is where a
// moderator decides whether a pattern of flags warrants a manual ban.
// This keeps the tracker conservative (no false-positive ban risk)
// while still surfacing the data needed to act when an actual cheater
// shows up.
package anticheat

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Detector parameters. Tuned for permissive defaults — a residential
// gigabit fibre seedbox still falls under the velocity ceiling.
type Config struct {
	// MaxUploadBytesPerSecond — above this we flag `velocity`. A
	// gigabit symmetric link tops out at ~125 MB/s in theory, but
	// real-world residential / corporate upload caps are far below.
	// 80 MB/s leaves enormous headroom for legitimate seedboxes
	// while still catching the multi-GB-per-announce fake-flood
	// pattern (typical of RatioMaster-style scripts).
	MaxUploadBytesPerSecond int64
}

// DefaultConfig returns the operator-friendly defaults. The handler
// can override individual fields without copy-pasting the rest.
func DefaultConfig() Config {
	return Config{MaxUploadBytesPerSecond: 80 * 1024 * 1024}
}

// Flag is one detection event. The handler builds a slice per
// announce; `Store` persists the whole slice in a single batch.
type Flag struct {
	UserID    string
	TorrentID *string // nil when the torrent row has gone away
	InfoHash  string
	Kind      string         // "velocity" | "no_leecher" | "unknown_client" | "event_skip"
	Severity  string         // "low" | "medium" | "high"
	Details   map[string]any // free-form, JSON-serialised at insert time
	PeerID    string
	IP        string
	UserAgent string
}

// Inputs carries everything the detector needs from the announce
// handler. Keeping it as a single struct lets the call site stay
// short and lets test code build fixtures concisely.
type Inputs struct {
	UserID            string
	TorrentID         string // may be empty when the torrent row is gone
	InfoHash          string // hex-encoded
	PeerIDHex         string
	IP                string
	UserAgent         string
	Event             string // "started" | "stopped" | "completed" | "update"
	Left              int64  // bytes the client still needs (0 → seeder)
	DeltaUp           int64  // bytes claimed since last announce
	DeltaDown         int64
	// PrevUpdatedAtMs — wall clock of the previous announce in unix
	// millis. Zero when this is the very first announce we see for
	// the (infoHash, peer) pair; in that case velocity detection is
	// skipped (we can't reason about rate without two samples).
	PrevUpdatedAtMs int64
	// Swarm counts BEFORE this peer's update is applied. The
	// no-leecher heuristic compares against this snapshot — if the
	// announcer were the only leecher, the natural count *after*
	// would include them and the rule would never fire.
	SwarmSeeders  int
	SwarmLeechers int
}

// Inspect runs every heuristic and returns the matching flags. Pure
// function — no I/O, no allocation outside the returned slice.
func Inspect(cfg Config, in Inputs) []Flag {
	flags := make([]Flag, 0, 2)
	now := time.Now()

	// ── 1. Velocity ───────────────────────────────────────────
	// Bytes/sec since last announce. Skipped when we don't have a
	// previous timestamp (first announce ever, or peer cycled out
	// of Redis between announces).
	if in.PrevUpdatedAtMs > 0 && in.DeltaUp > 0 {
		prev := time.UnixMilli(in.PrevUpdatedAtMs)
		elapsed := now.Sub(prev).Seconds()
		if elapsed > 0 {
			rate := float64(in.DeltaUp) / elapsed
			if int64(rate) > cfg.MaxUploadBytesPerSecond {
				flags = append(flags, Flag{
					UserID:    in.UserID,
					TorrentID: ptrOrNil(in.TorrentID),
					InfoHash:  in.InfoHash,
					Kind:      "velocity",
					Severity:  pickSeverityVelocity(rate, cfg.MaxUploadBytesPerSecond),
					PeerID:    in.PeerIDHex,
					IP:        in.IP,
					UserAgent: in.UserAgent,
					Details: map[string]any{
						"deltaUp":      in.DeltaUp,
						"elapsedSec":   round1(elapsed),
						"bytesPerSec":  int64(rate),
						"capBytesPerS": cfg.MaxUploadBytesPerSecond,
					},
				})
			}
		}
	}

	// ── 2. Upload to an empty swarm ───────────────────────────
	// You can't physically upload to someone who isn't there. The
	// guard uses *pre-update* leechers because the announcing peer
	// itself appears in the count after the upsert and would
	// otherwise legitimise its own upload to a one-leecher swarm
	// (the leecher being itself, which is impossible).
	if in.DeltaUp > 0 && in.SwarmLeechers == 0 {
		flags = append(flags, Flag{
			UserID:    in.UserID,
			TorrentID: ptrOrNil(in.TorrentID),
			InfoHash:  in.InfoHash,
			Kind:      "no_leecher",
			Severity:  "high",
			PeerID:    in.PeerIDHex,
			IP:        in.IP,
			UserAgent: in.UserAgent,
			Details: map[string]any{
				"deltaUp":       in.DeltaUp,
				"swarmSeeders":  in.SwarmSeeders,
				"swarmLeechers": in.SwarmLeechers,
			},
		})
	}

	// ── 3. Unknown peer_id signature ─────────────────────────
	// Real clients identify themselves with the BEP 20 prefix
	// (`-UT` / `-qB` / `-TR` / …). RatioMaster-family scripts often
	// rotate prefixes randomly, or use one that doesn't match the
	// User-Agent they advertise. We flag only when neither check
	// passes — a brand-new client could be unknown to us but
	// announce a coherent UA, in which case there's nothing to
	// say.
	prefix := peerIDPrefix(in.PeerIDHex)
	// Gated on `DeltaUp > 0` so an idle client with an unfamiliar
	// signature doesn't fire a flag on every 30-min update — only
	// the announces actually paying upload bytes are interesting
	// for triage.
	if in.DeltaUp > 0 && prefix != "" && !isKnownPeerIDPrefix(prefix) && !userAgentLooksReal(in.UserAgent) {
		flags = append(flags, Flag{
			UserID:    in.UserID,
			TorrentID: ptrOrNil(in.TorrentID),
			InfoHash:  in.InfoHash,
			Kind:      "unknown_client",
			Severity:  "low",
			PeerID:    in.PeerIDHex,
			IP:        in.IP,
			UserAgent: in.UserAgent,
			Details: map[string]any{
				"prefix": prefix,
			},
		})
	}

	// Note: an `event_skip` heuristic (paid bytes from a peer that
	// never sent `event=started`) was considered but yields no
	// signal under Trackarr's current delta logic — `deltaUp` is
	// forced to 0 when there's no previous announce AND the event
	// isn't `started`, so a cheater jumping straight to `completed`
	// just gets credited nothing rather than producing a flagged
	// audit row. Re-introduce only if the delta path changes.

	return flags
}

// Persist writes a batch of flags. Each row gets a UUID generated
// here so the caller doesn't have to. Best-effort: errors are logged
// but never bubble back to the announce handler — surfacing a
// detection failure to the BitTorrent client would expose detection
// state to attackers and break ordinary announces during DB hiccups.
//
// Aggregation: `no_leecher` flags collapse onto a single open row
// per (user, torrent) thanks to the partial unique index
// `anticheat_flags_no_leecher_open_unique`. The upsert sums
// `details.deltaUp`, bumps an `eventCount`, refreshes
// `lastEventAt`, and rotates the latest peer_id/ip/user-agent into
// place. Once a moderator reviews the row, subsequent events fall
// through the partial filter and start a fresh row — so the
// aggregation only ever covers a single open case.
func Persist(ctx context.Context, pool *pgxpool.Pool, flags []Flag) {
	if len(flags) == 0 {
		return
	}
	for _, f := range flags {
		id, err := newID()
		if err != nil {
			slog.Warn("anticheat: id generation failed", "err", err)
			continue
		}
		detailsJSON, err := json.Marshal(f.Details)
		if err != nil {
			detailsJSON = []byte("{}")
		}
		// `no_leecher` with a known torrent → upsert; everything
		// else → plain insert. The branch matches the partial
		// unique index in 0022_anticheat_no_leecher_unique.sql.
		if f.Kind == "no_leecher" && f.TorrentID != nil {
			_, err = pool.Exec(ctx,
				`INSERT INTO anticheat_flags
				   (id, user_id, torrent_id, info_hash, kind, severity, details,
				    peer_id, ip, user_agent, created_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
				 ON CONFLICT (user_id, torrent_id)
				   WHERE kind = 'no_leecher'
				     AND reviewed_at IS NULL
				     AND torrent_id IS NOT NULL
				 DO UPDATE SET
				   details = (
				     jsonb_set(
				       jsonb_set(
				         jsonb_set(
				           anticheat_flags.details,
				           '{deltaUp}',
				           to_jsonb(
				             COALESCE((anticheat_flags.details->>'deltaUp')::bigint, 0)
				             + COALESCE((EXCLUDED.details->>'deltaUp')::bigint, 0)
				           )
				         ),
				         '{eventCount}',
				         to_jsonb(COALESCE((anticheat_flags.details->>'eventCount')::int, 1) + 1)
				       ),
				       '{lastEventAt}',
				       to_jsonb(to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
				     )
				     || jsonb_build_object(
				          'swarmSeeders', EXCLUDED.details->'swarmSeeders',
				          'swarmLeechers', EXCLUDED.details->'swarmLeechers'
				        )
				   ),
				   peer_id    = EXCLUDED.peer_id,
				   ip         = EXCLUDED.ip,
				   user_agent = EXCLUDED.user_agent,
				   severity   = EXCLUDED.severity,
				   info_hash  = EXCLUDED.info_hash`,
				id, f.UserID, f.TorrentID, f.InfoHash, f.Kind, f.Severity,
				detailsJSON, f.PeerID, f.IP, f.UserAgent,
			)
		} else {
			_, err = pool.Exec(ctx,
				`INSERT INTO anticheat_flags
				   (id, user_id, torrent_id, info_hash, kind, severity, details,
				    peer_id, ip, user_agent, created_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
				id, f.UserID, f.TorrentID, f.InfoHash, f.Kind, f.Severity,
				detailsJSON, f.PeerID, f.IP, f.UserAgent,
			)
		}
		if err != nil {
			slog.Warn("anticheat: insert failed", "kind", f.Kind, "err", err)
		}
	}
}

// ── Helpers ──────────────────────────────────────────────────

func ptrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func round1(f float64) float64 {
	return float64(int(f*10+0.5)) / 10
}

func pickSeverityVelocity(rate float64, cap int64) string {
	mult := rate / float64(cap)
	switch {
	case mult >= 8:
		return "high"
	case mult >= 3:
		return "medium"
	default:
		return "low"
	}
}

// peerIDPrefix returns the BEP 20 / Shadow-style prefix from a hex-
// encoded 20-byte peer_id (so 40 hex chars). Empty when the prefix
// is non-printable junk (RatioMaster occasionally emits one).
func peerIDPrefix(hexed string) string {
	if len(hexed) < 8 {
		return ""
	}
	// First 4 bytes = first 8 hex chars. Azureus-style prefixes
	// look like "-UT3530-" (the leading dash + 2-letter code + 4
	// chars), so the first 6 characters (3 bytes) carry the
	// identification info.
	raw, err := hex.DecodeString(hexed[:8])
	if err != nil {
		return ""
	}
	for _, b := range raw {
		if b < 0x20 || b > 0x7e {
			return ""
		}
	}
	return string(raw)
}

// KnownPeerIDPrefixes — BEP 20 Azureus-style codes for the
// mainstream BitTorrent clients we see in the wild. Matched on the
// first two characters after the leading `-`.
//
// The list is deliberately permissive: a flag is informational, so
// missing an obscure client is fine. Adding to it is a no-cost
// operation when a moderator notices a false-positive pattern.
var knownPrefixes = map[string]struct{}{
	"AG": {}, "AR": {}, "AT": {}, "AV": {}, "AX": {}, "AZ": {}, // Ares, Arctic, Artemis, Avicora, BitPump, Azureus/Vuze
	"BB": {}, "BC": {}, "BF": {}, "BG": {}, "bk": {}, "BR": {}, "BS": {}, "BT": {}, "BW": {}, "BX": {},
	"CD": {}, "CT": {},
	"DE": {}, "DP": {},
	"EB": {}, "ES": {},
	"FC": {}, "FD": {}, "FL": {}, "FT": {}, "FW": {}, "FX": {},
	"GS": {},
	"HK": {}, "HL": {}, "HM": {}, "HN": {},
	"IL": {}, "JS": {}, "JT": {},
	"KG": {}, "KT": {},
	"LC": {}, "LH": {}, "LP": {}, "LT": {}, "lt": {}, "LW": {},
	"MK": {}, "MO": {}, "MP": {}, "MR": {}, "MT": {},
	"NB": {}, "NX": {},
	"OS": {}, "OT": {},
	"PB": {}, "PD": {}, "PI": {}, "PE": {}, "PT": {},
	"qB": {}, "QD": {}, "QT": {},
	"RT": {}, "RZ": {},
	"S~": {}, "SB": {}, "SD": {}, "SM": {}, "SP": {}, "SS": {}, "ST": {}, "SZ": {},
	"TN": {}, "TR": {}, "TS": {}, "TT": {},
	"UL": {}, "UM": {}, "UT": {}, "UE": {},
	"VG": {},
	"WT": {}, "WW": {}, "WY": {},
	"XL": {}, "XT": {}, "XX": {},
	"ZT": {},
}

func isKnownPeerIDPrefix(prefix string) bool {
	// Azureus-style: `-XXxxxx-…`
	if len(prefix) >= 3 && prefix[0] == '-' {
		_, ok := knownPrefixes[prefix[1:3]]
		return ok
	}
	// Shadow-style (single capital letter then 5 random chars). We
	// accept any [A-Z] prefix as legit here — the false-positive
	// cost of stricter matching outweighs the catch rate.
	if len(prefix) >= 1 {
		c := prefix[0]
		if c >= 'A' && c <= 'Z' {
			return true
		}
	}
	return false
}

// userAgentLooksReal — fast sanity check on the HTTP User-Agent
// header. Real clients send a vendor token (qBittorrent/4.8.10,
// uTorrent/3.5.5, Transmission/4.0.5, …). RatioMaster usually sends
// either no header at all or a custom marker.
func userAgentLooksReal(ua string) bool {
	if ua == "" {
		return false
	}
	low := strings.ToLower(ua)
	for _, hint := range []string{
		"qbittorrent", "utorrent", "transmission", "deluge",
		"libtorrent", "rtorrent", "azureus", "vuze", "bittorrent",
		"folx", "picotorrent", "biglybt", "tixati",
	} {
		if strings.Contains(low, hint) {
			return true
		}
	}
	return false
}

// newID — generate a 32-char hex random identifier suitable for the
// anticheat_flags primary key. Matches the convention the rest of
// the schema uses (text PK with random hex/UUID-style values).
func newID() (string, error) {
	var buf [16]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf[:]), nil
}
