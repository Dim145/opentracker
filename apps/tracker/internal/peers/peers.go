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
	"log/slog"
	"sync"
	"sync/atomic"
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

// Store wraps a Redis client and the global key prefix. We bake the prefix
// in here (rather than relying on a client-side hook) for two reasons:
//
//  1. The api uses ioredis's `keyPrefix` option which prepends `prefix +`
//     to every key. We want byte-for-byte the same keys so both apps see
//     the same physical Redis entries.
//  2. Mutating in-flight command args from a hook is fragile in go-redis;
//     string concat is trivial and unambiguous.
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
	// Les deux caches ci-dessus n'avaient aucun plafond. `expiresAt` n'est
	// consulté qu'en LECTURE, et seul `invalidateCounts` — appelé par `Set` et
	// `Remove` — supprime une entrée : une clé jamais réannoncée restait donc
	// en mémoire pour la vie du processus.
	//
	// Or `/scrape` ne demande aucune passkey et accepte 74 infohashes par
	// requête, donc l'espace des clés est choisi par n'importe qui sur
	// l'internet. Mesuré à 221 octets par entrée, soit environ 13,5 Mo/s de tas
	// définitivement retenu à mille requêtes par seconde. `resolve_miss` borne
	// bien les requêtes Postgres — pas la mémoire.
	//
	// Le voisinage avait déjà la réponse : `db.ipBanCache` est plafonné à
	// 50 000 entrées et `dedup` à 100 000, tous deux avec éviction.
	countsLen  atomic.Int64
	remoteLen  atomic.Int64
}

// maxSwarmCache borne chacun des deux caches de `Store`. Plein → on vide tout :
// une reconstruction coûte un HGETALL par essaim vivant, une fois, alors qu'un
// vrai LRU coûterait un verrou sur le chemin chaud de l'annonce.
const maxSwarmCache = 50_000

// storeBounded pose une entrée en tenant le plafond.
func storeBounded(m *sync.Map, n *atomic.Int64, key string, value any) {
	if n.Add(1) > maxSwarmCache {
		m.Range(func(k, _ any) bool { m.Delete(k); return true })
		n.Store(1)
	}
	m.Store(key, value)
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

// staleWriteWindowMs bounds how recently the stored snapshot must have been
// written for a lower-counter write to be treated as an out-of-order duplicate
// rather than as a client that restarted.
//
// 5 s is chosen to sit far above a request round-trip and far below the
// announce interval (900 s minimum): two announces for one peer inside 5 s are
// the same moment seen twice, while a client that genuinely restarted and now
// reports lower totals is minutes away and must be allowed to re-baseline.
const staleWriteWindowMs = 5000

// setPeerScript writes the peer snapshot unless a FRESHER one is already
// stored, in which case this write is the stale half of a concurrent pair and
// is dropped.
//
// Why this exists: `Set` used to overwrite unconditionally, so two announces
// for the same peer handled at the same moment — trivial to arrange once the
// tracker runs behind a load balancer — could leave the baseline at whichever
// value happened to land last. A baseline that goes backwards inflates the
// NEXT delta, which is credited bytes the member never transferred.
//
// The guard is deliberately time-scoped rather than a plain "counters may only
// increase". A monotonic rule would be wrong: a client that restarts reports
// from zero again, and the handler relies on being able to store that lower
// value to re-establish a baseline (it forfeits one interval of credit and
// then resumes). Only a *recent* stored snapshot can be the other half of a
// concurrent pair, so only a recent one blocks the write.
//
// cjson is used to READ the two counters for comparison and nothing else — the
// value written is the payload Go marshalled, byte for byte. Re-encoding in
// Lua would round int64 byte counts through a double.
var setPeerScript = redis.NewScript(`
local cur = redis.call('HGET', KEYS[1], ARGV[1])
if cur then
  local ok, d = pcall(cjson.decode, cur)
  if ok and type(d) == 'table' then
    local age = tonumber(ARGV[5]) - (tonumber(d.updatedAt) or 0)
    if age >= 0 and age <= tonumber(ARGV[6]) then
      if (tonumber(d.uploaded) or 0) > tonumber(ARGV[3])
         or (tonumber(d.downloaded) or 0) > tonumber(ARGV[4]) then
        return 0
      end
    end
  end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[7])
return 1
`)

// Set inserts or updates a peer in the swarm and refreshes the TTL.
//
// HSET and EXPIRE run inside the Lua script above, so they are applied as one
// step on the Redis side: a crash between the two cannot leave the hash without
// a TTL (which previously caused slow memory leaks on swarms that went idle
// right after their first peer). The same script is what drops a stale
// concurrent write.
func (s *Store) Set(ctx context.Context, infoHashHex string, p *PeerData) error {
	now := time.Now().UnixMilli()
	p.UpdatedAt = now
	data, err := json.Marshal(p)
	if err != nil {
		return err
	}
	key := s.peerKey(infoHashHex)
	written, err := setPeerScript.Run(ctx, s.client,
		[]string{key},
		p.PeerID, data, p.Uploaded, p.Downloaded,
		now, staleWriteWindowMs, int(s.peerTTL.Seconds()),
	).Int()
	if err != nil {
		return err
	}
	if written == 0 {
		// Not an error: a concurrent announce already stored a fresher
		// snapshot for this peer, so ours is the one to drop.
		slog.Debug("peers: skipped a stale concurrent write",
			"info_hash", infoHashHex, "peer_id", p.PeerID)
		return nil
	}
	// Invalidate the (seeders, leechers) cache for this swarm so a
	// stopped-and-restarted peer surfaces in counts immediately
	// instead of waiting out the cache TTL.
	s.invalidateCounts(infoHashHex)
	return nil
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
		if entry, ok := v.(*remoteCacheEntry); ok && time.Now().Before(entry.expiresAt) {
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
	storeBounded(&s.remoteCache, &s.remoteLen, infoHashHex, &remoteCacheEntry{
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
		// `, ok` plutôt qu'une assertion nue : la map ne porte qu'un type
		// aujourd'hui, et c'est exactement la garantie qu'un réemploi futur
		// casse en silence — par un panic sur le chemin chaud.
		if entry, ok := v.(*countsCacheEntry); ok && time.Now().Before(entry.expiresAt) {
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
	storeBounded(&s.countsCache, &s.countsLen, infoHashHex, &countsCacheEntry{
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

// resolveMissTTL bounds how long a "this site has no such torrent" answer is
// remembered for the scrape path.
//
// Five minutes: long enough that a flood of random hashes pays for one lookup
// each rather than one per request, short enough that a torrent uploaded a
// moment ago is scrapeable almost immediately. The value is only ever a
// NEGATIVE answer — a hash that resolves is not cached here, so a real torrent
// can never be hidden by this.
const resolveMissTTL = 5 * time.Minute

// RememberResolveMiss records that `infoHashHex` did not resolve to a torrent.
//
// Best-effort: a Redis failure here costs a repeated database lookup, which is
// exactly the state before this cache existed.
func (s *Store) RememberResolveMiss(ctx context.Context, infoHashHex string) {
	_ = s.client.Set(ctx, s.resolveMissKey(infoHashHex), "1", resolveMissTTL).Err()
}

// ResolveMissCached reports whether we already know this hash does not resolve.
func (s *Store) ResolveMissCached(ctx context.Context, infoHashHex string) bool {
	n, err := s.client.Exists(ctx, s.resolveMissKey(infoHashHex)).Result()
	return err == nil && n > 0
}

func (s *Store) resolveMissKey(h string) string { return s.prefix + "resolve_miss:" + h }

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

/*
 * creditBudgetScript — un seau à jetons par COMPTE.
 *
 * Le plafond de crédit existant (`maxCreditBytesPerSec × elapsed`, dans
 * `server/handler.go`) est dérivé de `peerHex` : il borne UN essaim vu par UN
 * peer_id. Son commentaire affirme que l'intégrale est bornée « no matter how
 * many rotated peer_ids » — vrai en rotation SÉQUENTIELLE, où un nouveau
 * peer_id a `prev == nil` et ne touche rien ; faux en CONCURRENCE, où les
 * fenêtres `[prev.UpdatedAt, now]` de deux peer_id différents se CHEVAUCHENT
 * au lieu d'être adjacentes.
 *
 * Cent peer_id ouverts en parallèle sur un même torrent, une annonce toutes les
 * deux secondes réclamant chacune +2 GiB : chaque peer_id passe son propre
 * clamp, et l'agrégat atteint 100 GiB/s — environ 6 TiB en une minute de temps
 * réel, pour cinquante requêtes par seconde. Le ratio et les rôles qui en
 * dérivent tombent. L'anti-triche lève bien `velocity` et `no_leecher`, mais ne
 * bloque rien.
 *
 * Ce seau borne donc l'axe sur lequel l'économie est réellement libellée : le
 * compte. Un seau à jetons plutôt qu'une fenêtre, pour qu'un seedeur honnête
 * qui vient de rester une heure inactif puisse dépenser sa réserve d'un coup
 * plutôt que d'être bridé à la seconde.
 *
 * KEYS[1] la clé du seau · ARGV[1] maintenant (ms) · ARGV[2] débit/s
 * ARGV[3] octets demandés · ARGV[4] réserve maximale
 */
var creditBudgetScript = redis.NewScript(`
local last   = tonumber(redis.call('HGET', KEYS[1], 'ts') or '0')
local now    = tonumber(ARGV[1])
local rate   = tonumber(ARGV[2])
local want   = tonumber(ARGV[3])
local burst  = tonumber(ARGV[4])
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tok') or '0')
if last == 0 then
  -- Premier passage : le seau est plein. Un compte qui vient d'arriver ne doit
  -- pas être bridé pendant une minute.
  tokens = burst
elseif now > last then
  tokens = math.min(burst, tokens + rate * ((now - last) / 1000))
end
local grant = math.min(tokens, want)
if grant < 0 then grant = 0 end
redis.call('HSET', KEYS[1], 'tok', tokens - grant, 'ts', now)
redis.call('EXPIRE', KEYS[1], 3600)
return math.floor(grant)
`)

// TakeCreditBudget réserve jusqu'à `want` octets sur le budget de ce compte et
// renvoie ce qui est accordé.
//
// Le débit est le même plafond par seconde que le clamp par pair, et la réserve
// vaut soixante secondes de ce débit : un seedeur réel ne s'en approche jamais,
// un client qui fabrique des deltas s'y heurte immédiatement.
func (s *Store) TakeCreditBudget(
	ctx context.Context, userID string, want, ratePerSec int64,
) (int64, error) {
	return creditBudgetScript.Run(ctx, s.client,
		[]string{s.creditBudgetKey(userID)},
		time.Now().UnixMilli(), ratePerSec, want, ratePerSec*60,
	).Int64()
}

func (s *Store) creditBudgetKey(u string) string {
	return s.prefix + "credit_budget:" + u
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
	// go-redis 9.22 raised its default read/write timeouts from 3 s to 5 s to
	// align with the cross-SDK config proposal. Announce is a hot path with an
	// http.Server WriteTimeout of 10 s, so a stalled Redis eating 5 s of that
	// budget twice over would blow the response deadline instead of failing
	// fast. Pin the previous 3 s explicitly — only when the URL didn't already
	// carry its own value, so `?read_timeout=` still wins.
	if opts.ReadTimeout == 0 {
		opts.ReadTimeout = 3 * time.Second
	}
	if opts.WriteTimeout == 0 {
		opts.WriteTimeout = 3 * time.Second
	}
	return redis.NewClient(opts), nil
}
