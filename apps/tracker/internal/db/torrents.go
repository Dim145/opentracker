package db

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrTorrentNotFound is returned when an info_hash does not match any active torrent.
var ErrTorrentNotFound = errors.New("torrent not found or inactive")

// Torrent holds just the fields the tracker needs.
type Torrent struct {
	ID string
}

// FindActiveTorrentByInfoHash looks up an active torrent by its 40-char hex
// info_hash. Inactive torrents are reported as not found so disabled
// torrents can't be re-announced.
func FindActiveTorrentByInfoHash(ctx context.Context, pool *pgxpool.Pool, infoHashHex string) (*Torrent, error) {
	const q = `SELECT id
	             FROM torrents
	            WHERE info_hash = $1
	              AND is_active = true
	            LIMIT 1`

	row := pool.QueryRow(ctx, q, infoHashHex)
	t := &Torrent{}
	if err := row.Scan(&t.ID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrTorrentNotFound
		}
		return nil, err
	}
	return t, nil
}
