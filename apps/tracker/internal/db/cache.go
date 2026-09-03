// Package db wraps the sqlc-generated queries with the small amount of
// stateful behaviour the tracker needs (settings cache, business helpers
// that translate raw setting strings into typed values, and a UUID
// generator for new HnR rows).
//
// All raw SQL lives in apps/tracker/db/queries — we never write SQL by
// hand here.
package db

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/florianjs/trackarr/apps/tracker/internal/bonus"
	"github.com/florianjs/trackarr/apps/tracker/internal/queries"
)

// Settings keys used by the tracker — must match the api's SETTINGS_KEYS.
const (
	KeyMinRatio            = "min_ratio"
	KeyHnrEnabled          = "hnr_enabled"
	KeyHnrRequiredSeedTime = "hnr_required_seed_time"
	KeyHnrGracePeriodSecs  = "hnr_grace_period"
)

// settingsTTL is hoisted into a var so tests can shrink it.
var settingsTTL = 60 * time.Second

// DB combines a connection pool with sqlc-generated queries plus a small
// settings cache so the announce hot path doesn't hit the DB for every
// `min_ratio` lookup.
type DB struct {
	Pool *pgxpool.Pool
	Q    *queries.Queries

	cacheMu sync.RWMutex
	cache   map[string]cachedSetting

	ipBanMu    sync.RWMutex
	ipBanCache map[string]cachedIPBan

	// rdb backs the passkey cache. Redis rather than a process-local map
	// like the two above, and the reason is the load balancer — see
	// UserByPasskey. nil disables the cache entirely, which is what the
	// tests use.
	rdb       *redis.Client
	keyPrefix string
}

type cachedSetting struct {
	value    string
	cachedAt time.Time
}

type cachedIPBan struct {
	banned   bool
	cachedAt time.Time
}

// New wraps a pool and the generated queries. `rdb` may be nil, which turns
// the passkey cache off and sends every lookup to Postgres.
func New(pool *pgxpool.Pool, rdb *redis.Client, keyPrefix string) *DB {
	return &DB{
		Pool:       pool,
		Q:          queries.New(pool),
		cache:      make(map[string]cachedSetting),
		ipBanCache: make(map[string]cachedIPBan),
		rdb:        rdb,
		keyPrefix:  keyPrefix,
	}
}

// GetSetting returns the raw string value for a settings key, falling back
// to `fallback` when the row is absent. Results are cached for settingsTTL
// seconds — invalidate from tests with InvalidateCache().
func (d *DB) GetSetting(ctx context.Context, key, fallback string) (string, error) {
	if v, ok := d.getCached(key); ok {
		return v, nil
	}

	v, err := d.Q.GetSetting(ctx, key)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			d.setCached(key, fallback)
			return fallback, nil
		}
		return "", err
	}
	d.setCached(key, v)
	return v, nil
}

// GetMinRatio returns the configured minimum ratio (0 = disabled).
// Malformed values fall back to 0 to avoid silently blocking announces.
func (d *DB) GetMinRatio(ctx context.Context) (float64, error) {
	raw, err := d.GetSetting(ctx, KeyMinRatio, "0")
	if err != nil {
		return 0, err
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, nil
	}
	return v, nil
}

// IsHnrEnabled reports whether hit-and-run tracking is on.
func (d *DB) IsHnrEnabled(ctx context.Context) (bool, error) {
	v, err := d.GetSetting(ctx, KeyHnrEnabled, "false")
	return v == "true", err
}

// GetHnrRequiredSeedTime returns the required seed time in seconds. Defaults
// to 24h if the row is absent or unparseable.
func (d *DB) GetHnrRequiredSeedTime(ctx context.Context) (int32, error) {
	v, err := d.GetSetting(ctx, KeyHnrRequiredSeedTime, "86400")
	if err != nil {
		return 86400, err
	}
	n, err := strconv.ParseInt(v, 10, 32)
	if err != nil {
		return 86400, nil
	}
	return int32(n), nil
}

// ipBanTTL bounds how long a banned_ips lookup is cached on the announce
// hot path; maxIPBanCache caps the map so a flood of distinct IPs can't
// grow it unbounded between expiries.
const ipBanTTL = 60 * time.Second
const maxIPBanCache = 50_000

// IsIpBanned reports whether `ip` is present in banned_ips. The api enforces
// banned_ips at the web/login tier; the announce/scrape path must honour it
// too, but a DB hit per announce would crush the hot path — so the boolean
// is cached per IP for ipBanTTL. Fails OPEN on a DB error (we never block a
// genuine announce because of a transient lookup failure). Hand-written SQL
// via the pool, mirroring the lazy-unban path in the handler (finding L8).
func (d *DB) IsIpBanned(ctx context.Context, ip string) (bool, error) {
	if ip == "" {
		return false, nil
	}
	d.ipBanMu.RLock()
	entry, ok := d.ipBanCache[ip]
	d.ipBanMu.RUnlock()
	if ok && time.Since(entry.cachedAt) <= ipBanTTL {
		return entry.banned, nil
	}

	var banned bool
	err := d.Pool.QueryRow(
		ctx,
		`SELECT EXISTS(SELECT 1 FROM banned_ips WHERE ip = $1)`,
		ip,
	).Scan(&banned)
	if err != nil {
		return false, err
	}

	d.ipBanMu.Lock()
	if len(d.ipBanCache) >= maxIPBanCache {
		d.ipBanCache = make(map[string]cachedIPBan)
	}
	d.ipBanCache[ip] = cachedIPBan{banned: banned, cachedAt: time.Now()}
	d.ipBanMu.Unlock()
	return banned, nil
}

// ResolveAnnouncedTorrent maps the infohash a client announced onto a torrent
// row and the swarm key its peers belong under.
//
// One infohash used to be the whole story. BEP 52 gave a torrent two: the v1
// SHA-1 and the v2 SHA-256, the latter truncated to 20 bytes on the wire
// because the tracker protocol has no room for 32. A hybrid torrent carries
// both, and a client that speaks v2 joins BOTH swarms — so it announces twice,
// under two different hashes, for the same content.
//
// Before this, the second announce found no row: the lookup was `info_hash`
// and nothing else. What the member saw was a torrent that worked and, beside
// it, an announce erroring every interval; what the swarm got was two halves
// that could not see each other, since v1-only peers and v2-capable peers were
// keyed apart in Redis.
//
// So: try v1 first, and only fall back to the v2 form when that misses.
//
//   - The v1 lookup is a unique-index hit and the overwhelmingly common case.
//     It is unchanged, and pays nothing for any of this.
//   - The fallback is a partial expression index over the v2 rows only. A v2
//     announce therefore costs two lookups where a v1 announce costs one,
//     which is the right way round: the rare case pays.
//
// The returned `swarmKey` is the CANONICAL `info_hash` in both cases. Callers
// use it for every keyed operation — peer set, dedup window, completed
// counter, seed-time bookkeeping — and that single substitution is what merges
// a hybrid torrent's two swarms into one.
//
// A note on what this deliberately does not do: it does not deduplicate a peer
// that announces both swarms with two different peer_ids. libtorrent reuses one
// peer_id, so the Redis key (swarm, peer) collapses the pair by itself and the
// common case is exact. A client that rotated its id would be counted twice —
// the same as a member running two clients today, and bounded by the same
// per-announce cap and anti-cheat heuristics. Deduplicating by (user, torrent)
// instead would mean rebuilding the peer store around a different key, which is
// a much larger change than the bug warrants.
// The per-torrent buffs ride along on the same row, so they cost nothing: the
// lookup had to happen anyway, and the SQL has already neutralised a lapsed
// buff. Callers combine them with the site-wide event via `bonus.Best`.
type ResolvedTorrent struct {
	ID string
	// SwarmKey is the CANONICAL v1 info_hash, whichever form was announced.
	SwarmKey    string
	Multipliers bonus.Multipliers
}

func (d *DB) ResolveAnnouncedTorrent(
	ctx context.Context,
	announcedHex string,
) (ResolvedTorrent, error) {
	row, err := d.Q.FindActiveTorrentByInfoHash(ctx, announcedHex)
	if err == nil {
		return ResolvedTorrent{
			ID:       row.ID,
			SwarmKey: announcedHex,
			Multipliers: bonus.Multipliers{
				Download: int(row.DownloadMultiplier),
				Upload:   int(row.UploadMultiplier),
			},
		}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return ResolvedTorrent{}, err
	}

	v2, v2Err := d.Q.FindActiveTorrentByInfoHashV2Short(ctx, announcedHex)
	if v2Err != nil {
		// Report the v1 miss, not the v2 one: pgx.ErrNoRows from either arm
		// means the same thing to the caller ("no such torrent"), and a
		// transient v2 failure would otherwise mask a clean not-found.
		if errors.Is(v2Err, pgx.ErrNoRows) {
			return ResolvedTorrent{}, err
		}
		return ResolvedTorrent{}, v2Err
	}
	return ResolvedTorrent{
		ID:       v2.ID,
		SwarmKey: v2.InfoHash,
		Multipliers: bonus.Multipliers{
			Download: int(v2.DownloadMultiplier),
			Upload:   int(v2.UploadMultiplier),
		},
	}, nil
}

// InvalidateCache drops every cached setting. Used in tests.
func (d *DB) InvalidateCache() {
	d.cacheMu.Lock()
	d.cache = make(map[string]cachedSetting)
	d.cacheMu.Unlock()
}

func (d *DB) getCached(key string) (string, bool) {
	d.cacheMu.RLock()
	defer d.cacheMu.RUnlock()
	entry, ok := d.cache[key]
	if !ok || time.Since(entry.cachedAt) > settingsTTL {
		return "", false
	}
	return entry.value, true
}

func (d *DB) setCached(key, value string) {
	d.cacheMu.Lock()
	d.cache[key] = cachedSetting{value: value, cachedAt: time.Now()}
	d.cacheMu.Unlock()
}

// NewID returns a fresh RFC 4122 v4 UUID as a 36-char hex string. Used to
// stamp new hnr_tracking rows.
func NewID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant RFC 4122

	out := make([]byte, 36)
	hex.Encode(out[0:8], b[0:4])
	out[8] = '-'
	hex.Encode(out[9:13], b[4:6])
	out[13] = '-'
	hex.Encode(out[14:18], b[6:8])
	out[18] = '-'
	hex.Encode(out[19:23], b[8:10])
	out[23] = '-'
	hex.Encode(out[24:36], b[10:16])
	return string(out), nil
}

// ── Passkey cache ───────────────────────────────────────────────

// passkeyTTL is how long a resolved passkey stays cached. Hoisted into a var
// so tests can shrink it.
//
// 60 s, the same budget the settings and IP-ban caches above already spend,
// and the ceiling is set by the same thing: a ban applied through the web UI
// is not visible to the tracker until the entry expires. That is the identical
// contract the IP-ban cache next door already carries, and it is written down
// in doc/guide/scaling.md rather than left for someone to discover.
var passkeyTTL = 60 * time.Second

// cachedUser is the subset of the users row the announce path needs. Kept as
// its own type rather than reusing the sqlc row so adding a column to the
// query cannot silently start being cached.
type cachedUser struct {
	ID         string `json:"id"`
	Uploaded   int64  `json:"up"`
	Downloaded int64  `json:"down"`
}

// passkeyKey is the Redis key for a resolved passkey.
//
// The passkey is HASHED, never stored. It is the announce credential: anyone
// who can read Redis could otherwise impersonate every member on the swarm.
// This mirrors the rule apps/api/utils/torznabStats.ts already follows for its
// own per-passkey keys, and 16 hex chars is 64 bits — far past collision range
// for any realistic member count.
func (d *DB) passkeyKey(passkey string) string {
	sum := sha256.Sum256([]byte(passkey))
	return d.keyPrefix + "trk:pk:" + hex.EncodeToString(sum[:])[:16]
}

// UserByPasskey resolves a passkey, through a short-lived Redis cache.
//
// This is the single hottest query in the system: `FindUserByPasskey` runs on
// EVERY announce, before anything else. It is also the one query a duplicate
// announce cannot avoid — the dedup that collapses an IPv4/IPv6 pair lives at
// step 4 of the handler, four checks later, so both copies reach Postgres.
//
// Redis rather than a process-local map like the caches above, and the load
// balancer is the whole reason: those duplicate copies arrive milliseconds
// apart on DIFFERENT instances, so a per-process cache would miss exactly the
// case worth catching. A shared entry means the second copy — wherever it
// lands — costs one Redis GET instead of a Postgres round-trip.
//
// Two rules keep it honest:
//
//   - A BANNED user is never cached. The handler's lazy-unban path writes to
//     Postgres and then falls through, so a cached "banned" would keep a
//     just-unbanned member locked out for the rest of the TTL. Banned users
//     are also the cold path by definition, so they lose nothing by paying for
//     a query.
//   - A MISS is never cached. An unknown passkey is either a typo or someone
//     probing, and neither repeats the same value often enough to be worth a
//     round-trip — while caching one would make a newly created member's first
//     announce fail for a minute if anything had probed their passkey first.
func (d *DB) UserByPasskey(ctx context.Context, passkey string) (queries.FindUserByPasskeyRow, error) {
	if d.rdb == nil {
		return d.Q.FindUserByPasskey(ctx, passkey)
	}
	key := d.passkeyKey(passkey)

	if raw, err := d.rdb.Get(ctx, key).Bytes(); err == nil {
		var c cachedUser
		if json.Unmarshal(raw, &c) == nil && c.ID != "" {
			return queries.FindUserByPasskeyRow{
				ID: c.ID, IsBanned: false, Uploaded: c.Uploaded, Downloaded: c.Downloaded,
			}, nil
		}
		// Unreadable entry: drop it and fall through to Postgres.
		_ = d.rdb.Del(ctx, key).Err()
	} else if err != redis.Nil {
		// Redis unreachable — the query still works, so say so once and carry
		// on rather than failing an announce over a cache.
		slog.Debug("passkey cache unavailable", "err", err)
	}

	row, err := d.Q.FindUserByPasskey(ctx, passkey)
	if err != nil || row.IsBanned {
		return row, err
	}
	if data, mErr := json.Marshal(cachedUser{
		ID: row.ID, Uploaded: row.Uploaded, Downloaded: row.Downloaded,
	}); mErr == nil {
		_ = d.rdb.Set(ctx, key, data, passkeyTTL).Err()
	}
	return row, nil
}

// InvalidatePasskey drops a cached passkey. Called from the tracker's own
// lazy-unban path, which is the one place the tracker itself changes a user's
// ban state; every other ban and unban happens in apps/api, and is covered by
// the TTL rather than by an invalidation contract spread over six write sites.
func (d *DB) InvalidatePasskey(ctx context.Context, passkey string) {
	if d.rdb == nil {
		return
	}
	_ = d.rdb.Del(ctx, d.passkeyKey(passkey)).Err()
}
