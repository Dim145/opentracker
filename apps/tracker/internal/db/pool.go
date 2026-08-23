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

// Open returns a configured pgxpool.Pool. Caller is responsible for Close().
//
// `maxConns` is per instance — see Config.DBMaxConns for why that matters once
// the tracker runs behind a load balancer. A non-positive value falls back to
// the historical 20 rather than letting pgx pick its own default (which is
// derived from CPU count and would change silently with the host).
func Open(ctx context.Context, dsn string, maxConns int) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	if maxConns <= 0 {
		maxConns = 20
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
