package db

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Setting keys used by the tracker — must match the api's SETTINGS_KEYS.
const (
	KeyMinRatio             = "min_ratio"
	KeyHnrEnabled           = "hnr_enabled"
	KeyHnrRequiredSeedTime  = "hnr_required_seed_time"
	KeyHnrGracePeriodSecs   = "hnr_grace_period"
)

// settingsCache mirrors the 60s TTL the Node tracker used. Tracker hits the
// settings table on every announce filter; without this we'd swamp Postgres.
type settingsCache struct {
	mu      sync.RWMutex
	entries map[string]cachedSetting
}

type cachedSetting struct {
	value     string
	cachedAt  time.Time
}

// settingsTTL is hoisted into a var so tests can shrink it.
var settingsTTL = 60 * time.Second

var defaultCache = &settingsCache{entries: make(map[string]cachedSetting)}

// GetSetting returns the raw string value for a settings key, falling back to
// `fallback` if the key is missing in the DB. Results are cached for
// `settingsTTL`. An empty string in the DB is treated as "no value".
func GetSetting(ctx context.Context, pool *pgxpool.Pool, key, fallback string) (string, error) {
	if v, ok := defaultCache.get(key); ok {
		return v, nil
	}

	const q = `SELECT value FROM settings WHERE key = $1 LIMIT 1`
	var v string
	err := pool.QueryRow(ctx, q, key).Scan(&v)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			defaultCache.set(key, fallback)
			return fallback, nil
		}
		return "", err
	}
	defaultCache.set(key, v)
	return v, nil
}

// GetMinRatio returns the configured minimum ratio (0 = disabled).
func GetMinRatio(ctx context.Context, pool *pgxpool.Pool) (float64, error) {
	raw, err := GetSetting(ctx, pool, KeyMinRatio, "0")
	if err != nil {
		return 0, err
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 0, nil // legacy: malformed value should not block announces
	}
	return v, nil
}

// IsHnrEnabled reports whether hit-and-run tracking is on.
func IsHnrEnabled(ctx context.Context, pool *pgxpool.Pool) (bool, error) {
	v, err := GetSetting(ctx, pool, KeyHnrEnabled, "false")
	return v == "true", err
}

// GetHnrRequiredSeedTime returns the required seed time in seconds.
func GetHnrRequiredSeedTime(ctx context.Context, pool *pgxpool.Pool) (int64, error) {
	v, err := GetSetting(ctx, pool, KeyHnrRequiredSeedTime, "86400")
	if err != nil {
		return 86400, err
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 86400, nil
	}
	return n, nil
}

// InvalidateSettingsCache drops every cached setting (used by tests).
func InvalidateSettingsCache() {
	defaultCache.mu.Lock()
	defaultCache.entries = make(map[string]cachedSetting)
	defaultCache.mu.Unlock()
}

func (c *settingsCache) get(key string) (string, bool) {
	c.mu.RLock()
	entry, ok := c.entries[key]
	c.mu.RUnlock()
	if !ok {
		return "", false
	}
	if time.Since(entry.cachedAt) > settingsTTL {
		return "", false
	}
	return entry.value, true
}

func (c *settingsCache) set(key, value string) {
	c.mu.Lock()
	c.entries[key] = cachedSetting{value: value, cachedAt: time.Now()}
	c.mu.Unlock()
}
