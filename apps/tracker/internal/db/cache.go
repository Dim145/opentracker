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
	"encoding/hex"
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

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
}

type cachedSetting struct {
	value    string
	cachedAt time.Time
}

type cachedIPBan struct {
	banned   bool
	cachedAt time.Time
}

// New wraps a pool and the generated queries.
func New(pool *pgxpool.Pool) *DB {
	return &DB{
		Pool:       pool,
		Q:          queries.New(pool),
		cache:      make(map[string]cachedSetting),
		ipBanCache: make(map[string]cachedIPBan),
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
