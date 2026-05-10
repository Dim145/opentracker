// Package peers stores swarm membership in Redis.
//
// The on-disk format is identical to what the legacy Node tracker wrote —
// JSON blobs in a Redis hash keyed by info_hash, with peer_id as the field.
// Keeping the format stable means apps/api can keep reading peer data
// without any change.
package peers

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// peerTTL matches the legacy 30-minute window. Redis evicts whole hashes
// after this delay if they're not touched.
const peerTTL = 30 * time.Minute

// PeerData is what we store in Redis. Field names match the JSON shape used
// by the Node implementation so callers (apps/api) keep working.
//
// `UserID` was added so the API's seed-bonus cron can map active
// seeders back to their user row without a passkey round-trip. The
// field is optional (omitempty) so old peer rows written before this
// migration deserialise cleanly — a missing UserID just means that
// peer doesn't qualify for bonus credit until its next announce
// rewrites the entry.
type PeerData struct {
	PeerID     string `json:"peerId"`
	UserID     string `json:"userId,omitempty"`
	IP         string `json:"ip"`
	IPHash     string `json:"ipHash"`
	Port       uint16 `json:"port"`
	Uploaded   int64  `json:"uploaded"`
	Downloaded int64  `json:"downloaded"`
	Left       int64  `json:"left"`
	IsSeeder   bool   `json:"isSeeder"`
	UpdatedAt  int64  `json:"updatedAt"` // unix millis
}

// Store wraps a Redis client and the global key prefix. We bake the prefix
// in here (rather than relying on a client-side hook) for two reasons:
//   1. The api uses ioredis's `keyPrefix` option which prepends `prefix +`
//      to every key. We want byte-for-byte the same keys so both apps see
//      the same physical Redis entries.
//   2. Mutating in-flight command args from a hook is fragile in go-redis;
//      string concat is trivial and unambiguous.
type Store struct {
	client *redis.Client
	prefix string
}

// New returns a Store. `keyPrefix` typically comes from REDIS_KEY_PREFIX
// (defaulting to "ot:").
func New(client *redis.Client, keyPrefix string) *Store {
	return &Store{client: client, prefix: keyPrefix}
}

// Set inserts or updates a peer in the swarm and refreshes the TTL.
// HSet+Expire run in a TxPipeline so they're applied atomically on
// the Redis side: a server crash between the two commands can't
// leave the hash without a TTL (which previously caused slow memory
// leaks on swarms that went idle right after their first peer).
func (s *Store) Set(ctx context.Context, infoHashHex string, p *PeerData) error {
	p.UpdatedAt = time.Now().UnixMilli()
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	key := s.peerKey(infoHashHex)
	pipe := s.client.TxPipeline()
	pipe.HSet(ctx, key, p.PeerID, data)
	pipe.Expire(ctx, key, peerTTL)
	_, err = pipe.Exec(ctx)
	return err
}

// Get returns nil if the peer is unknown or the stored JSON is unreadable.
func (s *Store) Get(ctx context.Context, infoHashHex, peerIDHex string) (*PeerData, error) {
	raw, err := s.client.HGet(ctx, s.peerKey(infoHashHex), peerIDHex).Bytes()
	if err != nil {
		if err == redis.Nil {
			return nil, nil
		}
		return nil, err
	}
	p := &PeerData{}
	if err := json.Unmarshal(raw, p); err != nil {
		// Corrupted entry: drop it so the peer can re-register.
		_ = s.client.HDel(ctx, s.peerKey(infoHashHex), peerIDHex).Err()
		return nil, nil
	}
	if time.Since(time.UnixMilli(p.UpdatedAt)) > peerTTL {
		_ = s.client.HDel(ctx, s.peerKey(infoHashHex), peerIDHex).Err()
		return nil, nil
	}
	return p, nil
}

// Remove deletes a single peer from the swarm.
func (s *Store) Remove(ctx context.Context, infoHashHex, peerIDHex string) error {
	return s.client.HDel(ctx, s.peerKey(infoHashHex), peerIDHex).Err()
}

// List returns all live peers in a swarm. Stale peers are pruned in-band.
func (s *Store) List(ctx context.Context, infoHashHex string) ([]*PeerData, error) {
	key := s.peerKey(infoHashHex)
	all, err := s.client.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	out := make([]*PeerData, 0, len(all))
	now := time.Now().UnixMilli()
	stale := make([]string, 0)
	for pid, raw := range all {
		p := &PeerData{}
		if err := json.Unmarshal([]byte(raw), p); err != nil {
			stale = append(stale, pid)
			continue
		}
		if now-p.UpdatedAt > peerTTL.Milliseconds() {
			stale = append(stale, pid)
			continue
		}
		out = append(out, p)
	}
	if len(stale) > 0 {
		_ = s.client.HDel(ctx, key, stale...).Err()
	}
	return out, nil
}

// Counts returns (seeders, leechers) for a swarm by walking List once.
func (s *Store) Counts(ctx context.Context, infoHashHex string) (seeders, leechers int, err error) {
	peers, err := s.List(ctx, infoHashHex)
	if err != nil {
		return 0, 0, err
	}
	for _, p := range peers {
		if p.IsSeeder {
			seeders++
		} else {
			leechers++
		}
	}
	return seeders, leechers, nil
}

// statsTTL keeps stats:* hashes alive long enough for live charts to
// render after a swarm goes idle, without leaking memory forever
// when a torrent is removed from the index. 7 days matches the
// admin charts horizon.
const statsTTL = 7 * 24 * time.Hour

// IncrementCompleted bumps the completed counter for a torrent.
// Atomic with Expire — if the hash didn't exist, the same TxPipeline
// stamps it with a TTL so we don't leak forever.
func (s *Store) IncrementCompleted(ctx context.Context, infoHashHex string) error {
	key := s.statsKey(infoHashHex)
	pipe := s.client.TxPipeline()
	pipe.HIncrBy(ctx, key, "completed", 1)
	pipe.Expire(ctx, key, statsTTL)
	_, err := pipe.Exec(ctx)
	return err
}

// CompletedCount returns the number of completed downloads for a torrent.
func (s *Store) CompletedCount(ctx context.Context, infoHashHex string) (int64, error) {
	v, err := s.client.HGet(ctx, s.statsKey(infoHashHex), "completed").Int64()
	if err == redis.Nil {
		return 0, nil
	}
	return v, err
}

func (s *Store) peerKey(h string) string  { return s.prefix + "peers:" + h }
func (s *Store) statsKey(h string) string { return s.prefix + "stats:" + h }

// NewClientFromURL parses REDIS_URL, applies the password, and returns a
// connected client. Caller should Ping() to confirm before serving traffic.
func NewClientFromURL(redisURL, password string) (*redis.Client, error) {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL: %w", err)
	}
	if password != "" {
		opts.Password = password
	}
	return redis.NewClient(opts), nil
}
