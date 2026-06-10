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
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// minPeerTTL is the smallest TTL we'll honour from the operator.
// Anything below the announce interval would silently zero every
// delta on the next announce (the `prev` snapshot in
// `server/handler.go` would already be gone). 15 minutes leaves a
// comfortable margin over the typical 30 min announce cadence
// without making misconfiguration catastrophic.
const minPeerTTL = 15 * time.Minute

// activeListWindow is the freshness window applied to peers we
// return to clients in `List()` (which feeds the bencoded announce
// response and the `(seeders, leechers)` counts). It's intentionally
// shorter than `peerTTL`:
//
//   - peerTTL bounds how long a peer entry sits in Redis. We want
//     it long (default 24 h) so a client's `prev` snapshot is still
//     around when it re-announces after a sleep / restart, otherwise
//     `handler.go` zeroes the upload/download delta for that gap.
//
//   - activeListWindow is what we consider "currently in the swarm"
//     for the purpose of advertising peers to other clients. If we
//     reused peerTTL here, every old session (with a new peer_id /
//     port after a qBittorrent restart) would stay in the response
//     for 24 h, and the requesting client would burn its connection
//     budget on ghosts that don't answer.
//
// Two announce intervals (2 × 30 min = 60 min) is the standard
// "missed one beat" cutoff — a peer that hasn't re-announced in
// that window is treated as gone.
const activeListWindow = 60 * time.Minute

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
// countsCacheTTL bounds how stale `Counts` is allowed to go. Each
// `(seeders, leechers)` lookup HGETALL-s the whole swarm hash and
// JSON-unmarshals every peer; a busy torrent can hold thousands of
// peers, and `handleAnnounce` calls `Counts` on every dedup hit
// AND every `event=stopped`. The cache keeps the cost flat at one
// fetch per swarm per `countsCacheTTL`, at the price of the swarm
// view being out of date by up to that interval. Clients re-
// announce on a 30-minute interval anyway, so 5 s of staleness is
// invisible end-to-end.
const countsCacheTTL = 5 * time.Second

type countsCacheEntry struct {
	seeders   int
	leechers  int
	expiresAt time.Time
}

// remoteCacheTTL bounds how stale `ListRemote` is allowed to go. When
// the federation-swarm flag is on, `ProcessAnnounce` calls `ListRemote`
// on EVERY announce — including the common case of a non-federated
// torrent whose `remote_peers:{hash}` key is simply absent, which still
// costs a full Redis round-trip per announce. The cache keeps that cost
// flat at one GET per torrent per `remoteCacheTTL`, caching the parsed
// `[]*PeerData` (or nil on miss) so repeated announces for the same
// torrent inside the window reuse the result. Kept short (2 s) because
// the API refreshes `remote_peers:*` on its own cadence and a couple of
// seconds of staleness is invisible to clients announcing every 30 min.
const remoteCacheTTL = 2 * time.Second

type remoteCacheEntry struct {
	peers     []*PeerData
	expiresAt time.Time
}

type Store struct {
	client *redis.Client
	prefix string
	// peerTTL is the live-peer expiry window. Sourced from the
	// `TRACKER_PEER_TTL` env (default 24 h). Clamped to `minPeerTTL`
	// at construction so a misconfigured value can't break the delta
	// computation in `server/handler.go`.
	peerTTL time.Duration
	// countsCache is process-local — each Go replica maintains its
	// own. The hot announce path lives behind this, so per-replica
	// caching is fine; we accept that a peer joining replica A may
	// not show up in replica B's `Counts` for up to `countsCacheTTL`.
	countsCache sync.Map // string → *countsCacheEntry
	// remoteCache mirrors countsCache for `ListRemote`: process-local,
	// `sync.Map`-backed, short-lived. Spares the federation-swarm hot
	// path a Redis GET on every announce for the same torrent within
	// `remoteCacheTTL`.
	remoteCache sync.Map // string → *remoteCacheEntry
}

// New returns a Store. `keyPrefix` typically comes from
// `REDIS_KEY_PREFIX` (defaulting to `ot:`). `ttl` is the peer expiry
// window; values below `minPeerTTL` are silently clamped to that
// floor so a typo in the env can't reduce the window to a value that
// would zero every delta on the next announce.
func New(client *redis.Client, keyPrefix string, ttl time.Duration) *Store {
	if ttl < minPeerTTL {
		ttl = minPeerTTL
	}
	return &Store{client: client, prefix: keyPrefix, peerTTL: ttl}
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
	pipe.Expire(ctx, key, s.peerTTL)
	_, err = pipe.Exec(ctx)
	// Invalidate the (seeders, leechers) cache for this swarm so a
	// stopped-and-restarted peer surfaces in counts immediately
	// instead of waiting out the cache TTL.
	s.invalidateCounts(infoHashHex)
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
	if time.Since(time.UnixMilli(p.UpdatedAt)) > s.peerTTL {
		_ = s.client.HDel(ctx, s.peerKey(infoHashHex), peerIDHex).Err()
		return nil, nil
	}
	return p, nil
}

// Remove deletes a single peer from the swarm.
func (s *Store) Remove(ctx context.Context, infoHashHex, peerIDHex string) error {
	err := s.client.HDel(ctx, s.peerKey(infoHashHex), peerIDHex).Err()
	s.invalidateCounts(infoHashHex)
	return err
}

// List returns the peers we consider currently in the swarm. Stale
// peers (older than `peerTTL`) are pruned from Redis in-band; peers
// that are still inside `peerTTL` but older than `activeListWindow`
// are skipped from the returned slice — they stay in Redis for the
// delta computation in `server/handler.go` but aren't advertised to
// other clients.
func (s *Store) List(ctx context.Context, infoHashHex string) ([]*PeerData, error) {
	key := s.peerKey(infoHashHex)
	all, err := s.client.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	out := make([]*PeerData, 0, len(all))
	now := time.Now().UnixMilli()
	stale := make([]string, 0)
	activeCutoffMs := activeListWindow.Milliseconds()
	for pid, raw := range all {
		p := &PeerData{}
		if err := json.Unmarshal([]byte(raw), p); err != nil {
			stale = append(stale, pid)
			continue
		}
		age := now - p.UpdatedAt
		if age > s.peerTTL.Milliseconds() {
			// Truly expired — drop from Redis.
			stale = append(stale, pid)
			continue
		}
		if age > activeCutoffMs {
			// Still useful for delta tracking but not for the
			// announce response — silently skip.
			continue
		}
		out = append(out, p)
	}
	if len(stale) > 0 {
		_ = s.client.HDel(ctx, key, stale...).Err()
		// Stale-prune changed the swarm view — drop the cached
		// counts so the next `Counts` call reflects the prune.
		s.invalidateCounts(infoHashHex)
	}
	return out, nil
}

// ListRemote returns peers cached from partner instances for this torrent
// (Phase 4 cross-announce). The API's federation sync writes a JSON array of
// PeerData to `remote_peers:{infoHash}` with a short TTL; we read it as-is.
// Returns nil on miss / parse error — cross-announce is strictly best-effort
// and must never fail an announce.
func (s *Store) ListRemote(ctx context.Context, infoHashHex string) ([]*PeerData, error) {
	// Short-lived cache hit: reuse the last result (including a cached
	// nil for absent / unparseable keys) so repeated announces for the
	// same torrent inside `remoteCacheTTL` skip the Redis round-trip.
	if v, ok := s.remoteCache.Load(infoHashHex); ok {
		entry := v.(*remoteCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.peers, nil
		}
	}
	raw, err := s.client.Get(ctx, s.remotePeerKey(infoHashHex)).Bytes()
	if err != nil {
		if err == redis.Nil {
			// Cache the miss too — the common non-federated torrent has
			// no key, and re-GETting it every announce is exactly the
			// cost this cache exists to remove.
			s.cacheRemote(infoHashHex, nil)
			return nil, nil
		}
		// Transient Redis error: don't cache (so we retry next time),
		// and never break the announce.
		return nil, err
	}
	var out []*PeerData
	if err := json.Unmarshal(raw, &out); err != nil {
		s.cacheRemote(infoHashHex, nil)
		return nil, nil
	}
	s.cacheRemote(infoHashHex, out)
	return out, nil
}

// cacheRemote stores a ListRemote result under a fresh `remoteCacheTTL`.
func (s *Store) cacheRemote(infoHashHex string, p []*PeerData) {
	s.remoteCache.Store(infoHashHex, &remoteCacheEntry{
		peers:     p,
		expiresAt: time.Now().Add(remoteCacheTTL),
	})
}

func (s *Store) remotePeerKey(h string) string { return s.prefix + "remote_peers:" + h }

// Counts returns (seeders, leechers) for a swarm. Walks List once
// per `countsCacheTTL` per swarm; concurrent callers either share
// the cached value or — if the cache is cold/expired — race to
// repopulate it (acceptable; the duplicate work is bounded).
func (s *Store) Counts(ctx context.Context, infoHashHex string) (seeders, leechers int, err error) {
	if v, ok := s.countsCache.Load(infoHashHex); ok {
		entry := v.(*countsCacheEntry)
		if time.Now().Before(entry.expiresAt) {
			return entry.seeders, entry.leechers, nil
		}
	}
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
	s.countsCache.Store(infoHashHex, &countsCacheEntry{
		seeders:   seeders,
		leechers:  leechers,
		expiresAt: time.Now().Add(countsCacheTTL),
	})
	return seeders, leechers, nil
}

// invalidateCounts drops the cached count entry for a swarm so the
// next `Counts` call is forced to refresh. Called by `Set` and
// `Remove` so a write surfaces in the count without waiting out
// the TTL. Cheap: a `sync.Map.Delete` is lock-free.
func (s *Store) invalidateCounts(infoHashHex string) {
	s.countsCache.Delete(infoHashHex)
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

// completedOnceTTL bounds the snatch-dedup marker. It only needs to outlast
// realistic replay attempts; the authoritative completion record is the
// hnr_tracking row in Postgres.
const completedOnceTTL = 180 * 24 * time.Hour

// MarkFirstCompletion atomically records that (userID, torrentID) completed
// and reports whether this was the FIRST time. Keyed on the stable
// (user, torrent) pair — not the attacker-chosen peer_id — so a client
// replaying event=completed (or rotating peer_ids) can't inflate the public
// snatch counter (finding L12).
func (s *Store) MarkFirstCompletion(ctx context.Context, torrentID, userID string) (bool, error) {
	key := s.prefix + "completed_once:" + torrentID + ":" + userID
	return s.client.SetNX(ctx, key, "1", completedOnceTTL).Result()
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
