package db

import (
	"context"
	"crypto/rand"
	"encoding/hex"

	"github.com/jackc/pgx/v5/pgxpool"
)

// CreateHnrEntry inserts a hit-and-run row when a user marks a torrent
// completed for the first time. ON CONFLICT DO NOTHING preserves the
// existing row if the user re-announces "completed" later.
func CreateHnrEntry(ctx context.Context, pool *pgxpool.Pool, userID, torrentID string, requiredSeedTime int64) error {
	id, err := newID()
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO hnr_tracking (
			id, user_id, torrent_id,
			downloaded_at, seed_time, required_seed_time,
			is_hnr, is_exempt
		)
		VALUES ($1, $2, $3, NOW(), 0, $4, false, false)
		ON CONFLICT (user_id, torrent_id) DO NOTHING`
	_, err = pool.Exec(ctx, q, id, userID, torrentID, requiredSeedTime)
	return err
}

// UpdateSeedTime adds `additional` seconds to a peer's seed time. If the
// total reaches required_seed_time the row is also stamped as completed.
func UpdateSeedTime(ctx context.Context, pool *pgxpool.Pool, userID, torrentID string, additional int64) error {
	const q = `
		UPDATE hnr_tracking
		   SET seed_time = seed_time + $1,
		       completed_at = CASE
		         WHEN completed_at IS NULL
		          AND seed_time + $1 >= required_seed_time
		         THEN NOW()
		         ELSE completed_at
		       END,
		       is_hnr = CASE
		         WHEN completed_at IS NULL
		          AND seed_time + $1 >= required_seed_time
		         THEN false
		         ELSE is_hnr
		       END
		 WHERE user_id = $2
		   AND torrent_id = $3
		   AND is_exempt = false
		   AND completed_at IS NULL`
	_, err := pool.Exec(ctx, q, additional, userID, torrentID)
	return err
}

// FindUserAndTorrentIDs returns the (user_id, torrent_id) pair matching an
// announce passkey + info_hash. Returns ("", "", nil) when either lookup
// fails — HnR updates are best-effort.
func FindUserAndTorrentIDs(ctx context.Context, pool *pgxpool.Pool, passkey, infoHashHex string) (userID, torrentID string, err error) {
	const q = `
		SELECT u.id, t.id
		  FROM users u, torrents t
		 WHERE u.passkey = $1
		   AND t.info_hash = $2
		   AND t.is_active = true
		 LIMIT 1`
	err = pool.QueryRow(ctx, q, passkey, infoHashHex).Scan(&userID, &torrentID)
	return
}

func newID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	// RFC 4122 variant + version 4
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	hexBuf := make([]byte, 36)
	hex.Encode(hexBuf[0:8], b[0:4])
	hexBuf[8] = '-'
	hex.Encode(hexBuf[9:13], b[4:6])
	hexBuf[13] = '-'
	hex.Encode(hexBuf[14:18], b[6:8])
	hexBuf[18] = '-'
	hex.Encode(hexBuf[19:23], b[8:10])
	hexBuf[23] = '-'
	hex.Encode(hexBuf[24:36], b[10:16])
	return string(hexBuf), nil
}
