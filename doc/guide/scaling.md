# Scaling out

Running more than one replica of each service. Written from measurements, not
from theory — where a number appears here, it was observed. The correctness
sections come from a two-to-five instance battery; the sizing and Postgres
sections come from a seeded 350 000-member, 2 000 000-row dataset under load.

Read this before adding a replica of anything. The failures in here are silent
ones: the schema keeps working, the site keeps serving, and the numbers in the
database quietly stop meaning what they say.

Deploying the replicas on Kubernetes: [Kubernetes](./kubernetes).

## The short version

| Service | Multiple replicas? | Blockers |
| --- | --- | --- |
| **Web (Nuxt SSR)** | Yes | none |
| **API (Nitro)** | Yes | shared storage for uploads — or `STORAGE_DRIVER=s3`, which removes the requirement |
| **Tracker (Go)** | Yes | align the secrets, size the connection budget, get `TRUST_PROXY` right |
| **Postgres** | Single primary | see [High availability](./high-availability) for the standby story. Not a throughput ceiling — 0.4 ms per announce, measured. The limits are write amplification and maintenance; see [The actual limit](#the-actual-limit) |

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

Two ways out, and only one of them needs new infrastructure to be found:

- **Shared filesystem.** Point `UPLOADS_DIR` at NFS, or at a `ReadWriteMany`
  PVC on Kubernetes. Works, but most default `StorageClass`es are
  ReadWriteOnce — k3s's `local-path`, EBS, GCE PD and Azure Disk all are — so
  in practice this means standing up NFS, CephFS, EFS or Azure Files.
- **Object storage.** `STORAGE_DRIVER=s3` sends uploads to an S3-compatible
  bucket instead, and the shared volume stops existing as a requirement. The
  Helm chart's `storage:` block does the wiring and can install RustFS
  in-cluster if you have no store already. See
  [Object storage](./object-storage).

Either way, nothing else about the API needs changing.

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
| Passkeys | 60 s | **a newly banned MEMBER keeps announcing for up to a minute.** Shared in Redis rather than per instance, and a banned row is never cached, so an unban takes effect at once. There is deliberately no invalidation: bans are written in six places across the API and the tracker, and an invalidation someone forgets is worse than a bounded, documented delay |
| Swarm counts | short | two clients may see slightly different seeder counts |

## The actual limit

Load-balancing the tracker removes a correctness problem. It does not, by
itself, make the system carry more traffic — but the reason is not the one this
guide gave until it was measured. **The constraint is not Postgres.**

### Every announce is floored at 30 ms on purpose

`minAnnounceLatency` in
[`handler.go`](https://github.com/Dim145/opentracker/blob/main/apps/tracker/internal/server/handler.go)
sleeps every announce response up to 30 ms, so that a valid passkey and an
invalid one take the same observable time. Without it the sub-millisecond
rejection of a bad passkey is a timing oracle for enumerating good ones.

Measured on an idle instance, one client, no contention:

| Endpoint | Serial latency | Work it does |
| --- | --- | --- |
| `/scrape` | **0.3 ms** | Redis only |
| `/announce` | **31.8 ms** | full path, then sleeps to the floor |

The gap is the sleep, not the work. So per-instance capacity is set by how many
requests an instance can hold *in flight*, not by how fast it computes one:

```
announces/s per instance ≈ concurrent_in_flight / 0.030
```

The sleep runs in a `defer`, after the handler body has returned its database
connection, so a waiting request costs one goroutine and one socket — not a
pooled connection. That is why the curve below is nearly linear until the host
runs out of CPU, and why `TRACKER_DB_MAX_CONNS` made no measurable difference
at any point in the battery.

Two instances, persistent connections, every announce crediting a real delta:

| In-flight requests | Announces/s | p50 | p95 | p99 |
| --- | --- | --- | --- | --- |
| 1 | 31 | 31.8 ms | 34.3 ms | 36.6 ms |
| 4 | 127 | 31.3 ms | 33.0 ms | 36.7 ms |
| 16 | 508 | 30.8 ms | 32.2 ms | 33.9 ms |
| 64 | 1 841 | 30.5 ms | 39.9 ms | 68.9 ms |
| 256 | 2 757 | 37.3 ms | 78.0 ms | 103.9 ms |
| 512 | 1 917 | 37.8 ms | 65.9 ms | 93.5 ms |

Up to 64 in flight the throughput is 86–96 % of `concurrency / 30 ms` and p50
never leaves the floor: the instance is idle, just waiting. Past ~256 the host
saturates and p50 finally rises above 30 ms — that is the first point in the
whole battery where a real resource, rather than the deliberate sleep, is the
thing being measured.

### Where the CPU actually goes

Four tracker instances, four load generators on distinct member/torrent pairs so
every announce credits and nothing is deduplicated away, run until the host was
CPU-bound. Container CPU sampled 14 times during the run:

| Component | Cores | Cores per 1 000 announces/s | Share |
| --- | --- | --- | --- |
| Tracker (4 instances) | 2.93 | 0.61 | 51 % |
| Postgres | 2.26 | 0.47 | 39 % |
| Redis | 0.60 | 0.12 | 10 % |
| **Server total** | **5.79** | **1.20** | |

4 811 announces/s sustained. **The tracker itself uses more CPU than Postgres
does.** Repeating the run with overlapping pairs — so the credit dedup absorbs
three announces in four, which is closer to real traffic where most announces
report no progress — gave 8 415 announces/s for 4.6 server cores, or **0.55
cores per 1 000 announces/s**.

Both figures were taken with the host saturated, so contention inflates them:
treat them as a pessimistic bound, not a target.

### What Postgres actually costs per announce

From `pg_stat_statements`, steady state, realistic swarm mix (populated swarms,
70 % leechers), 350 000 members and 2 000 000 `hnr_tracking` rows:

| Statement | Calls per announce | Mean | Path |
| --- | --- | --- | --- |
| `IncrementUserStats` — `UPDATE users` | 1.00 | 0.118 ms | request |
| `BumpUserTorrentBytes` — `UPDATE hnr_tracking` | 1.00 | 0.097 ms | request |
| anti-cheat `INSERT … ON CONFLICT DO UPDATE` | 0.78 | 0.100 ms | background |
| `FindActiveTorrentByInfoHash` — `SELECT` | 1.00 | 0.051 ms | request |
| `FindUserAndTorrentByPasskeyAndHash` — `SELECT` | 0.30 | 0.059 ms | background |
| `AddSeedTime` — `UPDATE hnr_tracking` | 0.30 | 0.042 ms | background |
| **Total** | **4.38** | **0.375 ms** | |

**0.375 ms of Postgres execution time per announce.** One saturated core would
execute 2 600 announces/s of that; the measured 347 000-member workload needs
about 200/s. Postgres was never close to being the throughput ceiling.

Two things in that table are avoidable rather than intrinsic:

- `BumpUserTorrentBytes` and `AddSeedTime` **update the same `hnr_tracking`
  row** on the same announce, in two statements and two round trips, producing
  two row versions where one would do. They merge into a single `UPDATE`.
- `recordSeedTime` re-runs `FindUserAndTorrentByPasskeyAndHash` to obtain the
  `(user_id, torrent_id)` pair **the request handler already held**. Passing the
  two ids into the goroutine removes a statement outright.

### The one number that does move: cache residency

Same dataset, same load, only `shared_buffers` and the container memory
limit changed:

| `shared_buffers` / container RAM | Buffer hit | Postgres per announce | Announces/s | p99 |
| --- | --- | --- | --- | --- |
| 1 GB / unlimited (711 MB database fits) | 100.00 % | **0.375 ms** | 1 934 | 62 ms |
| 128 MB / 512 MB (it does not fit) | 96.64 % | **1.221 ms** | 1 214 | 840 ms |

A 3.4 % miss rate costs **3.3× the Postgres time per announce**, 37 % of the
throughput, and turns a 62 ms p99 into 840 ms. Nothing else in the battery —
not the pool size, not `synchronous_commit`, not the instance count — moved the
numbers remotely as much.

Growing the data hurts far less than losing the cache. Seven times the members
and fifteen times the tracking rows cost 2.3× the time per announce, and only
because the b-trees got deeper:

| Dataset | Database | Statements/announce | Postgres/announce |
| --- | --- | --- | --- |
| 50 000 members, 130 000 hnr rows | 93 MB | 3.96 | 0.163 ms |
| 350 000 members, 2 000 000 hnr rows | 711 MB | 4.38 | 0.375 ms |

### So what is Postgres actually the ceiling for?

Not throughput. Two things:

1. **Write amplification.** Every credited announce rewrites a `users` row, an
   `hnr_tracking` row (twice), and often an `anticheat_flags` row. Each rewrite
   that cannot be a HOT update rewrites *every index on the table* as well.
   Migration `0032` addressed this directly — dropping a duplicate unique index
   on `users(passkey)` and a redundant `hnr_user_idx`, making `hnr_status_idx`
   partial, and setting `fillfactor = 85` on `users`. Measured before: `users`
   at **74 % HOT** with 4 indexes. Measured after, on the bench: **100 % HOT**,
   with `hnr_tracking` at 99.0–99.9 %.
2. **Maintenance, and it is not optional.** At roughly 890 bytes of WAL per
   credited announce, 200 announces/s is **15 GB of WAL per day**. That is the
   number that sizes archive storage, backup windows and replica bandwidth —
   and dead tuples accumulate at the same rate, which is why `0032` also drops
   `autovacuum_vacuum_scale_factor` to 0.02 on the three churning tables.

Adding a read replica does nothing for either. Both are properties of the write
path, and both are fixed in the schema and in the announce handler.

**Still not done — batching the stat increments.** Accumulate deltas in Redis
and flush periodically in one multi-row `UPDATE`. It is the change that turns
per-announce writes into grouped transactions, and it moves the crash-loss
window from "one announce" to "one flush interval" — a trade to make
deliberately rather than by accident.

**Done — the passkey lookup is cached.** `FindUserByPasskey` runs on every
announce before anything else, and a duplicate announce cannot avoid it: the
dedup that collapses an IPv4/IPv6 pair sits four checks later, so both copies
would otherwise reach Postgres. The cache lives in Redis rather than in each
process precisely because a balancer sends those copies to different instances.
Measured interleaved, with Redis and peer state reset between runs: **about
26 % fewer Postgres transactions** (2925 / 2555 without, 2201 / 1845 with — the
absolute saving was 724 and 710, and that consistency is what makes it
believable). Read it as an upper bound: the harness credits 6 seconds after the
baseline, so the entry is always warm, while real traffic leaves 90 seconds or
more between one member's announces and the 60 s entry will often have expired.
What survives in production is the duplicate-and-retry traffic, which is
exactly what it was built for.

## Sizing

### By traffic

The announce rate follows from the member count, not from page views:

```
announces/s ≈ members × active_share × torrents_per_member / 1800
```

with 1800 s the announce interval. Peak is roughly 3× steady state, once events
and the 900 s `min_interval` are counted.

| Members | Announces/s steady / peak | Tracker | Postgres | Redis | Web + API |
| --- | --- | --- | --- | --- | --- |
| ≤ 10 000 | 6 / 20 | 1 × 0.5 vCPU, 128 MB | 2 vCPU, 4 GB | 0.5 vCPU, 512 MB | 1 × each |
| 50 000 | 28 / 85 | 1 × 1 vCPU, 256 MB | 4 vCPU, 8 GB | 1 vCPU, 1 GB | 2 × each |
| 350 000 | 195 / 585 | 2 × 1 vCPU, 512 MB | 8 vCPU, 16 GB | 2 vCPU, 2 GB | 2–3 × each |
| 1 000 000 | 555 / 1 665 | 3 × 2 vCPU, 1 GB | 16 vCPU, 32 GB | 4 vCPU, 4 GB | 4 × each |

Read those rows as headroom, not as a fit. At 585 announces/s the pessimistic
1.20 cores per 1 000/s puts the entire server side — tracker, Postgres and
Redis together — at **0.7 cores**. The vCPU counts above are sized for the
website sharing the same primary, for `VACUUM` and `REINDEX` having somewhere to
run, and for the peak lasting longer than you planned. **The RAM column is the
one that matters**, and it is sized to hold the working set, per the cache
measurement above.

Two instances appear at 350 000 members for availability, not for capacity: one
instance handled 1 934 announces/s in the battery, more than three times that
row's peak. Run two so that losing one is not an outage.

### By data volume

Measured, not extrapolated — `pg_total_relation_size` on the seeded 350 000-member
dataset:

| Table | Rows | Heap | Indexes | Total | Per row |
| --- | --- | --- | --- | --- | --- |
| `hnr_tracking` | 2 000 000 | 204 MB | 239 MB | 442 MB | 221 B |
| `users` | 350 000 | 77 MB | 57 MB | 134 MB | 383 B |
| `torrents` | 200 000 | 27 MB | 92 MB | 119 MB | 595 B |
| `anticheat_flags` | 10 496 | 3.8 MB | 1.8 MB | 5.7 MB | 555 B |
| **Database** | | | | **711 MB** | |

Three things to take from it:

- **`hnr_tracking` is the table that grows**, at one row per (member, torrent)
  pair ever touched — not per torrent. It is already 62 % of the database at
  350 000 members and it keeps growing after members stop seeding.
- **`torrents` is index-heavy**: 92 MB of indexes on 27 MB of heap. Every index
  added there is paid on the search path *and* on every upload.
- Plan disk as `database × 3` for WAL, autovacuum slack and one in-place dump.
  At 350 000 members that is a comfortable 100 GB volume, not 500 GB — the
  earlier column sizes storage for years of growth, not for today.

## Recommended Postgres configuration

For the 350 000-member row — 8 vCPU, 16 GB, SSD. Every value here is either
justified by a measurement above or is the standard tuning for the hardware
class.

```ini
# ── Memory ───────────────────────────────────────────────────────────────
# The single highest-impact setting in the whole battery. It must hold the
# hot set: users + hnr_tracking + torrents, 711 MB at 350k members. Going
# from a cache that fits to one that does not cost 3.3x the Postgres time
# per announce and a 13x worse p99.
shared_buffers = 4GB                    # 25 % of RAM
effective_cache_size = 12GB             # 75 % of RAM — a planner hint, not an allocation
work_mem = 16MB                         # per sort node; 200 connections could ask for it at once
maintenance_work_mem = 512MB            # VACUUM and REINDEX on a 442 MB table

# ── Write path ───────────────────────────────────────────────────────────
# ~890 bytes of WAL per credited announce, so ~15 GB/day at 200/s. max_wal_size
# is deliberately generous: checkpoints triggered by volume rather than by time
# are what produce full-page-write storms.
wal_buffers = 16MB
max_wal_size = 4GB
min_wal_size = 1GB
checkpoint_completion_target = 0.9      # spread the flush, do not spike the disk
wal_compression = on                    # cheap on this workload; the WAL is mostly full-page images

# ── Storage assumptions (SSD/NVMe) ───────────────────────────────────────
random_page_cost = 1.1                  # the 4.0 default assumes spinning rust
effective_io_concurrency = 200

# ── Connections ──────────────────────────────────────────────────────────
# Web and API go through PgBouncer; the tracker keeps its own pgx pool sized
# by TRACKER_DB_MAX_CONNS (default 20). Sum the pools, do not guess.
max_connections = 200

# ── Durability ───────────────────────────────────────────────────────────
# Cluster default stays on: the website must not lose a committed transaction.
# The tracker sets synchronous_commit=off on ITS connections only, via
# TRACKER_SYNCHRONOUS_COMMIT, because losing the last few announce deltas in a
# crash is acceptable and losing a password change is not. Measured effect at
# these rates: within noise — the 30 ms floor hides it. Keep it for the day the
# floor is not the limit.
synchronous_commit = on

# ── Autovacuum ───────────────────────────────────────────────────────────
# Dead tuples arrive at the announce rate. The 20 % default means 400 000 dead
# rows on hnr_tracking before a vacuum starts. Per-table scale factors of 0.02
# are already set by migration 0032 on users, hnr_tracking and anticheat_flags;
# these are the cluster-wide knobs that let those run promptly.
autovacuum_max_workers = 4
autovacuum_naptime = 15s
autovacuum_vacuum_cost_limit = 2000     # the 200 default throttles vacuum into irrelevance

# ── Observability ────────────────────────────────────────────────────────
# Every per-statement number in this guide came from pg_stat_statements. It is
# not optional on a tracker: without it, "Postgres is slow" is unfalsifiable.
shared_preload_libraries = 'pg_stat_statements'
pg_stat_statements.track = all
track_io_timing = on
```

Scale `shared_buffers` and `effective_cache_size` with RAM and leave the rest
alone. On 4 GB use `shared_buffers = 1GB` / `effective_cache_size = 3GB`; on
32 GB, `8GB` / `24GB`.

## What to watch

Four queries. If these four are healthy, the write path is healthy.

```sql
-- 1. HOT ratio on the churning tables. Below ~95 % means index rewrites on
--    every update: check fillfactor, and check for a new index on a column
--    the announce path writes.
SELECT relname, n_tup_upd, n_tup_hot_upd,
       round(100.0 * n_tup_hot_upd / NULLIF(n_tup_upd, 0), 1) AS hot_pct
FROM pg_stat_user_tables
WHERE relname IN ('users', 'hnr_tracking', 'anticheat_flags');

-- 2. Buffer hit ratio. The measurement above says this is the number that
--    matters most. Below 99 % on this workload, add RAM.
SELECT round(100.0 * blks_hit / NULLIF(blks_hit + blks_read, 0), 2) AS hit_pct,
       blks_read, round(blk_read_time) AS read_ms
FROM pg_stat_database WHERE datname = current_database();

-- 3. Cost per announce. Divide by the announce count over the same window;
--    0.4 ms is the measured steady state at 350k members.
SELECT round(sum(total_exec_time)) AS total_ms, sum(calls) AS calls
FROM pg_stat_statements;

-- 4. Dead tuples and whether autovacuum is keeping up.
SELECT relname, n_live_tup, n_dead_tup, last_autovacuum
FROM pg_stat_user_tables
WHERE n_dead_tup > 10000 ORDER BY n_dead_tup DESC;
```

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

### Reproducing the sizing measurements

Same idea at scale: seed a dataset, load it, and read `pg_stat_statements`
rather than guessing. Postgres needs `shared_preload_libraries =
'pg_stat_statements'` and `track_io_timing = on` before it will tell you
anything useful, and both need a restart.

Reset `pg_stat_statements` between the warm-up and the measured run, or the
warm-up's cold-path `INSERT`s dominate the averages and every statement looks
three times more expensive than it is.

Four traps beyond the two above, each of which produced a wrong number first:

- **An `info_hash` is 20 bytes, so 40 hex characters.** Seeding it with `md5()`
  gives 16 bytes and every announce is rejected with `Invalid info_hash length`
  — over HTTP 200, per the trap above.
- **An announce whose delta is zero never touches the database.** The credit
  block is gated on `deltaUp > 0 || deltaDown > 0`, so a generator that sends a
  constant `uploaded=N` writes on the first announce per peer and measures a
  write-free path for every one after it. Increase the value each round.
- **A peer with no previous state credits nothing**, by design — a cumulative
  counter is never treated as a standalone delta. So the worst case, where every
  announce writes, needs a warm-up round immediately before the measured one.
- **The credit dedup is keyed on `(info_hash, peer_id)`.** Two load generators
  drawing from the same seed hit the same pairs, and three announces in four are
  absorbed before reaching Postgres — which reads as excellent throughput and
  measures almost nothing. Give each generator its own seed.

And one about the harness rather than the tracker: **a client that opens a
connection per request saturates long before the server does.** Switching the
generator to persistent connections took the same load from 1 025 to 1 936
announces/s without touching a single server-side setting. If a measurement says
the server is the limit, prove the generator is not first — `/scrape` is the
control, since it touches Redis only and answers in 0.3 ms.
