# Scaling out

Running more than one replica of each service. Written from measurements on a
two-instance tracker, not from theory — where a number appears here, it was
observed.

Read this before adding a replica of anything. The failures in here are silent
ones: the schema keeps working, the site keeps serving, and the numbers in the
database quietly stop meaning what they say.

## The short version

| Service | Multiple replicas? | Blockers |
| --- | --- | --- |
| **Web (Nuxt SSR)** | Yes | none |
| **API (Nitro)** | Yes | shared storage for uploads |
| **Tracker (Go)** | Yes | align the secrets, size the connection budget, get `TRUST_PROXY` right |
| **Postgres** | Single primary | it is the real ceiling — see [The actual limit](#the-actual-limit) |

## Web and API

Both are already written for it, which is worth knowing before you go looking
for problems that were solved:

- **Sessions are sealed cookies** (iron, keyed on `NUXT_SESSION_SECRET`). No
  server-side session store, so no sticky sessions and no shared cache.
- **Cron ticks are single-flighted** across replicas by `utils/cronLock.ts` —
  a Redis `SET NX` with a Lua compare-and-swap release, and it fails *closed*,
  so a Redis outage means the tick is skipped rather than run by everybody.
- **Rate limits live in Redis**, keyed per client. The in-memory path exists
  only as a fallback when Redis errors; while it is in use each replica limits
  independently.
- **Notifications fan out through Redis pub/sub**, so every replica sees every
  event.

### One thing to fix first: uploads

`docker-compose.prod.yml` mounts `uploads_data`, a **`driver: local`** volume,
into the API. With replicas on more than one host, a `.torrent` written by
replica A is simply missing on replica B — a download 404s depending on which
replica answered.

Give `UPLOADS_DIR` shared storage (NFS, or an object store behind a small
adapter) before adding the second API replica. Nothing else about the API
needs changing.

### And one thing to check

SSE connections are long-lived. No sticky sessions are needed — each replica
subscribes to Redis independently — but the load balancer's idle timeout has to
be longer than the notification stream's quiet periods, or clients reconnect in
a loop.

## Tracker

### What already works across instances

Verified by reading the code and, where marked, by running two instances
against one Postgres and one Redis:

- **Peer state, swarm counts and the `completed` counter** live in Redis, one
  hash per torrent. Nothing peer-related is held in process memory that
  matters.
- **UDP `connection_id` is stateless**: `HMAC-SHA256(IP_HASH_SECRET, ip‖minute)`
  folded to 64 bits. Any instance can validate an id issued by any other, which
  is normally *the* blocker for load-balancing a BitTorrent tracker.
- **There is no singleton background job.** No peer reaper, no stats flusher,
  no leader to elect — peer expiry is a Redis TTL.
- **Bonus multipliers** are a read-through cache of a Redis snapshot the API
  writes.
- **Announce, byte-credit and seed-time deduplication** — see below. *Measured.*

### The one that was broken: duplicate credit

Until the Redis dedup layer landed, running two instances **double-credited
upload and download**.

The mechanism: a client announcing on IPv4 and IPv6 sends the same announce
twice, milliseconds apart. On one instance the in-memory dedup catches the
second. Behind a round-robin balancer the two land on *different* processes,
neither can see the other's map, both read the same Redis baseline, both compute
the same delta, and `users.uploaded` is an atomic `+=` — so the over-credit is
durable and it propagates to ratio, bonus and hit-and-run.

Measured, one instance versus two, same 1 MB transfer:

| | credited |
| --- | --- |
| One instance, announce sent twice | 1 000 000 |
| Two instances, announce in parallel | **2 000 000** |

The fix keeps the in-memory map as a free first filter and adds a Redis
`SET NX PX 2000`; a key must be fresh in both to be credited. The same guard
covers all three dedup keys — the per-event announce key, the `:credit` key that
gates the byte delta, and the `:seedtime` key that gates seed-time accrual — so
all three became correct at once. `internal/server/dedup.go` carries the
reasoning; `TestDedup_CrossInstance` is the regression guard.

After the fix, the same experiment credits 1 000 000 in both cases.

### Environment that must match on every instance

| Variable | Why |
| --- | --- |
| `IP_HASH_SECRET` | UDP `connection_id`s issued by one instance are rejected by another if this differs, and `ip_hash` values diverge — which silently breaks anti-cheat correlation |
| `REDIS_URL`, `REDIS_KEY_PREFIX` | the dedup, peer state and bonus snapshot are all keyed under the prefix |
| `DATABASE_URL` | obviously, but note the connection budget below |
| `TRUST_PROXY` | see the warning |

::: danger `TRUST_PROXY` is the mistake that will actually happen
With a balancer in front, the peer's real address arrives in a header. If
`TRUST_PROXY` is off — or on, but the balancer does not set the header — then
**every peer's IP becomes the balancer's**. Swarm peer lists collapse to one
address, IP bans stop matching anybody, and anti-cheat correlates every member
with every other.

Nothing errors. The tracker keeps answering 200 and the swarm keeps working
well enough that nobody notices for a while.

Check it after the first deploy: the tracker logs `announce clientIP` with
`resolved`, `remoteAddr`, `xForwardedFor` and `xRealIP` side by side. `resolved`
must be the member's address, not the balancer's.
:::

### Size the connection budget

`TRACKER_DB_MAX_CONNS` caps the Postgres pool **per instance**, default `20` —
the value the pool was hardcoded to before it became a setting, so an existing
deployment behaves identically after upgrading.

The number to plan for is the product: four instances at the default open up to
**80** connections between them, before counting the API's replicas. Either
size PgBouncer's `default_pool_size` and Postgres's `max_connections` for that,
or lower `TRACKER_DB_MAX_CONNS` so the product stays where it was — four
instances at `5` cost the cluster exactly what one at `20` did.

Anything outside `1..1000` falls back to 20, rather than letting pgx derive its
own default from the host's CPU count — which would change silently when you
move hosts. The upper bound is not decoration: the value is narrowed to pgx's
`int32`, so an unchecked `3000000000` would land as a *negative* pool size.

### UDP needs a layer-4 balancer

If `TRACKER_UDP_ENABLED` is on, the balancer must forward UDP. Many
application-layer balancers do TCP only. Either use L4/DSR, or give each
instance its own published port and let clients spread across them — the
stateless `connection_id` makes either safe.

### Caches diverge, briefly

Per-instance and TTL-bounded, so this is staleness rather than corruption — but
know the consequences:

| Cache | TTL | Consequence |
| --- | --- | --- |
| Settings | 60 s | a settings change takes up to a minute to apply everywhere |
| IP bans | 60 s | **a newly banned IP keeps announcing for up to a minute** |
| Swarm counts | short | two clients may see slightly different seeder counts |

## The actual limit

Load-balancing the tracker removes a correctness problem. It does **not** make
the system carry more traffic, because the constraint is Postgres, and adding
tracker instances multiplies the load on it rather than relieving it.

Per announce, on the hot path: `FindUserByPasskey`, then
`FindActiveTorrentByInfoHash`, then up to three writes (`IncrementUserStats`,
`BumpUserTorrentBytes`, `InsertUserTorrentBytes`). Settings and IP-ban lookups
are served from the in-process caches.

Sizing, with the announce interval of 1800 s:

```
announces/s ≈ members × active_share × torrents_per_member / 1800
```

At 347 000 members, a 25 % active share and 4 torrents each: **≈ 190
announces/s** in steady state, and 300–600/s at peak once events and the 900 s
`min_interval` are counted. That is roughly **600 reads/s and 900 writes/s**
through PgBouncer, on the same primary that serves the website.

Two changes move that ceiling, and **neither has been made**:

1. **Cache `FindUserByPasskey` in Redis.** The hottest query in the system, run
   on every single announce. A short TTL removes almost all of it.
2. **Batch the stat increments.** Accumulate deltas in Redis and flush
   periodically in one multi-row `UPDATE`. This turns ~900 writes/s into a
   handful of grouped transactions — and it moves the crash-loss window from
   "one announce" to "one flush interval", which is a trade to make
   deliberately rather than by accident.

Do these before, or alongside, adding tracker instances. Adding instances first
brings the ceiling closer.

## Two races that load balancing widened

Both were **pre-existing** — a single instance could already interleave two
concurrent requests — and running several only widened the window. Both are now
closed.

### The peer baseline could move backwards

`peers.Set` overwrote the stored snapshot unconditionally, so of two announces
for one peer handled at the same moment, whichever landed last won. If that was
the one carrying *lower* cumulative counters, the baseline went backwards — and
a baseline that goes backwards inflates the **next** delta, which is credited
bytes the member never transferred.

The write is now a Lua script that drops a write whose counters are lower than
a snapshot stored **within the last 5 seconds**.

The time bound is the whole design, not a detail. A plain "counters may only
increase" rule would have been wrong: a client that restarts reports from zero
again, and the handler *relies* on storing that lower value to re-establish a
baseline — it forfeits one interval of credit and then resumes. Only a very
recent snapshot can be the other half of a concurrent pair, so only a very
recent one blocks the write. 5 s sits far above a request round-trip and far
below the 900 s minimum announce interval.

Verified against a real Redis, not just the test double: announce 2 MB, then
1 MB immediately (rejected), then 2.5 MB after the window — credited 500 kB, so
the baseline held at 2 MB. Without the guard it would have credited 1.5 MB.

`cjson` reads the two counters for the comparison and nothing else; the value
written is the payload Go marshalled, byte for byte. Re-encoding in Lua would
round int64 byte counts through a double.

### Duplicate anti-cheat flags

Only the `no_leecher` kind was protected, by the partial unique index it upserts
against. Every other kind was a plain `INSERT`, so two announces that differ in
event — running in two processes, behind a balancer — filed the same evidence
twice in the moderation queue.

Flags now pass through the same dedup as the credit, keyed per kind
(`<hash>:<peer>:acflag:<kind>`) on the same 2-second window. Two announces
milliseconds apart are one event and produce one flag; the same detector firing
again ten minutes later is new evidence and is still recorded.

The filter lives in the announce handler rather than in the `anticheat` package,
which stays a pure detector with no Redis dependency.

## What the battery measured

Two to five instances against one Postgres and one Redis, each announce
duplicated across different instances so the dedup is what stands between the
run and a double credit.

**Correctness — the result that matters.** Exact at every level, including the
hardest arrangement: the same announce fired at *all* N instances at once.

| Instances | Copies of each announce | Requests | Credited | Expected |
| --- | --- | --- | --- | --- |
| 2 | 2 | 16 | 8 000 000 | 8 000 000 |
| 3 | 3 | 24 | 8 000 000 | 8 000 000 |
| 4 | 4 | 32 | 8 000 000 | 8 000 000 |
| 5 | 5 | 40 | 8 000 000 | 8 000 000 |

Under load — 300 peers, 600 requests, every announce sent twice — the credited
total was exactly 300 000 000 at 1, 2, 3 and 5 instances. Repeated with one
user row per peer, to remove row-lock contention as a variable: same exact
total.

**Throughput — and why this test cannot answer that question.** It went *down*
as instances were added: 665 → 444 req/s on the credited path, 1 to 5. Before
reading that as an argument against load balancing, note the control: the
`/scrape` path, which touches Redis and never writes to Postgres, is flat
across the same range (1443 / 1307 / 1165 / 1355 req/s — noise, no trend).

A path with no database writes that also fails to scale can only be limited by
the host. Everything here — the load generator, five tracker processes,
Postgres, Redis and the rest of the stack — shares one machine, so there is no
capacity to add and instances only add overhead. **The battery validates
correctness under concurrency; it says nothing about throughput**, and any real
measurement needs the instances on separate hardware with the load generator
somewhere else again.

## Reproducing the measurements

The two-instance experiment is worth keeping in your hands, because it is the
only way to be sure a change to the credit path has not reopened the hole:

1. Start two tracker containers on the same networks, sharing the stack's
   Postgres and Redis.
2. Create a throwaway user with a known passkey, and pick an `is_active`
   torrent.
3. Announce a baseline (`uploaded=0&event=started`), **wait at least 2 s**, then
   send the same `uploaded=N` announce to both instances in parallel.
4. Read `users.uploaded`. It must have moved by `N`, not `2N`.

Two traps that will waste an afternoon:

- **An announce that fails still returns HTTP 200**, with a bencoded
  `failure reason` in the body. Read the body, never the status.
- **Announces less than a second apart credit nothing at all.**
  `maxByElapsed = 80 MiB × (elapsed_ms / 1000)` truncates to whole seconds, so a
  sub-second gap allows zero bytes. Wait between the baseline and the credited
  announce or the experiment measures nothing and looks like a pass.
