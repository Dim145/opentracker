// Package db owns the tracker's PostgreSQL access.
//
// We deliberately keep this small: only the queries the announce handler
// actually needs. Schema migrations are still owned by the api (Drizzle).
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// defaultDBConns is what the pool was hardcoded to before TRACKER_DB_MAX_CONNS
// existed; keeping it as the fallback means an unset or nonsensical value
// behaves exactly as the previous release did.
const defaultDBConns = 20

// maxDBConns bounds what an operator may ask for. Postgres itself is usually
// configured for a few hundred connections in total, so a per-instance pool
// beyond this cannot be satisfied — and the ceiling is what makes the int32
// narrowing below provably safe.
const maxDBConns = 1000

// Open returns a configured pgxpool.Pool. Caller is responsible for Close().
//
// `maxConns` is per instance — see Config.DBMaxConns for why that matters once
// the tracker runs behind a load balancer. A value outside the bounds falls
// back to the historical 20 rather than letting pgx pick its own default
// (which is derived from CPU count and would change silently with the host).
func Open(ctx context.Context, dsn string, maxConns int) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	// Both bounds, and the upper one is not decoration: `maxConns` arrives
	// from strconv.Atoi as a platform int, and narrowing an unchecked one to
	// pgx's int32 turns `TRACKER_DB_MAX_CONNS=3000000000` into a NEGATIVE
	// pool size. Checking `<= 0` after the conversion would be too late, so
	// the range check happens first and rejects the value outright — a
	// four-digit pool is a typo, not a request (same reasoning as
	// clampTemplateQuota in apps/api).
	if maxConns <= 0 || maxConns > maxDBConns {
		maxConns = defaultDBConns
	}
	cfg.MaxConns = int32(maxConns)
	cfg.MinConns = 2
	cfg.MaxConnIdleTime = 30 * time.Second
	cfg.ConnConfig.ConnectTimeout = 10 * time.Second

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect to db: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping db: %w", err)
	}
	return pool, nil
}
