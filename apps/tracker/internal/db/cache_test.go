package db

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// The passkey cache is exercised without a Postgres pool on purpose: every
// test here takes a path that must NOT reach the database, and a nil pool
// turns "it quietly queried anyway" from an invisible inefficiency into a
// panic.
func newCacheDB(t *testing.T) (*DB, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return New(nil, client, "ot:"), mr
}

const testPasskey = "0123456789abcdef0123456789abcdef"

func seed(t *testing.T, d *DB, mr *miniredis.Miniredis, u cachedUser) string {
	t.Helper()
	raw, err := json.Marshal(u)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	key := d.passkeyKey(testPasskey)
	mr.Set(key, string(raw))
	return key
}

func TestUserByPasskey_ServesFromCacheWithoutTouchingPostgres(t *testing.T) {
	d, mr := newCacheDB(t)
	seed(t, d, mr, cachedUser{ID: "u1", Uploaded: 42, Downloaded: 7})

	// A nil pool means any fallback to Postgres panics rather than passing.
	row, err := d.UserByPasskey(context.Background(), testPasskey)
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if row.ID != "u1" || row.Uploaded != 42 || row.Downloaded != 7 {
		t.Fatalf("wrong row: %+v", row)
	}
	if row.IsBanned {
		t.Fatal("a cached row is never a banned one — see UserByPasskey")
	}
}

// The passkey is the announce credential. Anyone able to read Redis must not
// be able to lift it and impersonate a member on the swarm, so neither the key
// nor the value may contain it — the same rule torznabStats.ts follows.
func TestUserByPasskey_NeverStoresTheRawPasskey(t *testing.T) {
	d, mr := newCacheDB(t)
	key := seed(t, d, mr, cachedUser{ID: "u1", Uploaded: 1, Downloaded: 2})

	if strings.Contains(key, testPasskey) {
		t.Fatalf("the passkey is in the Redis key: %s", key)
	}
	for _, k := range mr.Keys() {
		if strings.Contains(k, testPasskey) {
			t.Fatalf("the passkey is in a Redis key: %s", k)
		}
		v, _ := mr.Get(k)
		if strings.Contains(v, testPasskey) {
			t.Fatalf("the passkey is in a Redis value under %s", k)
		}
	}
}

func TestUserByPasskey_KeyIsStableAndDistinct(t *testing.T) {
	d, _ := newCacheDB(t)
	// Liés à des variables, et non comparés en place : le test EST valide —
	// appeler deux fois et comparer vérifie bien le déterminisme, y compris si
	// `passkeyKey` se mettait un jour à saler — mais staticcheck y voit deux
	// expressions identiques (SA4000) parce qu'il présume la pureté. Nommer les
	// deux résultats dit l'intention au lecteur et à l'analyseur.
	first := d.passkeyKey(testPasskey)
	second := d.passkeyKey(testPasskey)
	if first != second {
		t.Fatal("the same passkey must map to the same key")
	}
	if d.passkeyKey(testPasskey) == d.passkeyKey(testPasskey+"x") {
		t.Fatal("different passkeys must map to different keys")
	}
	if !strings.HasPrefix(d.passkeyKey(testPasskey), "ot:") {
		t.Fatal("the key must carry the configured prefix so the API's keyspace is shared cleanly")
	}
}

func TestInvalidatePasskey_DropsTheEntry(t *testing.T) {
	d, mr := newCacheDB(t)
	key := seed(t, d, mr, cachedUser{ID: "u1"})
	if !mr.Exists(key) {
		t.Fatal("precondition: the entry should exist")
	}
	d.InvalidatePasskey(context.Background(), testPasskey)
	if mr.Exists(key) {
		t.Fatal("the entry survived invalidation")
	}
}

// A corrupted entry must not be served and must not wedge the cache: it is
// dropped, and the next call is free to repopulate it.
func TestUserByPasskey_DropsAnUnreadableEntry(t *testing.T) {
	d, mr := newCacheDB(t)
	key := d.passkeyKey(testPasskey)
	mr.Set(key, "{not json")

	// The fallback would need Postgres, so the panic IS the assertion that we
	// left the cache and went to the database.
	defer func() {
		if recover() == nil {
			t.Fatal("an unreadable entry was served instead of being discarded")
		}
		if mr.Exists(key) {
			t.Fatal("the unreadable entry should have been deleted")
		}
	}()
	_, _ = d.UserByPasskey(context.Background(), testPasskey)
}

func TestUserByPasskey_ExpiryIsBounded(t *testing.T) {
	d, mr := newCacheDB(t)
	key := seed(t, d, mr, cachedUser{ID: "u1"})
	mr.SetTTL(key, passkeyTTL)

	mr.FastForward(passkeyTTL + time.Second)
	if mr.Exists(key) {
		t.Fatalf("the entry outlived its TTL of %v — a ban would stay invisible", passkeyTTL)
	}
}

// With no Redis client the cache is simply absent; the wrapper must go
// straight to the query rather than misbehaving.
func TestUserByPasskey_NoRedisMeansNoCache(t *testing.T) {
	d := New(nil, nil, "ot:")
	defer func() {
		if recover() == nil {
			t.Fatal("with rdb nil the lookup must reach the database")
		}
	}()
	_, _ = d.UserByPasskey(context.Background(), testPasskey)
}
