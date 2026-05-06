package db

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrUserNotFound is returned when a passkey does not match any user.
var ErrUserNotFound = errors.New("user not found")

// User is the projection of `users` we need to validate an announce.
type User struct {
	ID         string
	IsBanned   bool
	Uploaded   int64
	Downloaded int64
}

// FindUserByPasskey returns the user owning the given passkey, or
// ErrUserNotFound if none does.
func FindUserByPasskey(ctx context.Context, pool *pgxpool.Pool, passkey string) (*User, error) {
	const q = `SELECT id, is_banned, uploaded, downloaded
	             FROM users
	            WHERE passkey = $1
	            LIMIT 1`

	row := pool.QueryRow(ctx, q, passkey)
	u := &User{}
	if err := row.Scan(&u.ID, &u.IsBanned, &u.Uploaded, &u.Downloaded); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	return u, nil
}

// IncrementUserStats adds delta upload/download to the user identified by
// passkey. Skipping when both deltas are 0 saves a DB round-trip.
func IncrementUserStats(ctx context.Context, pool *pgxpool.Pool, passkey string, deltaUp, deltaDown int64) error {
	if deltaUp == 0 && deltaDown == 0 {
		return nil
	}
	const q = `UPDATE users
	              SET uploaded   = uploaded   + $1,
	                  downloaded = downloaded + $2
	            WHERE passkey = $3`
	_, err := pool.Exec(ctx, q, deltaUp, deltaDown, passkey)
	return err
}
