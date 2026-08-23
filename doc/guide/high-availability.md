# High availability

[Scaling out](./scaling) covers running more than one replica of the stateless
services. This page covers the stateful ones — Postgres, Redis, PgBouncer and
Caddy are each a single container today, and each is a single point of failure.

Read it alongside the sizing measurements in that guide, because the numbers
change the answer: at 4 811 announces/s Redis used **0.60 of a core** and
Postgres **2.26**. Neither is short of capacity. So what follows is about
*availability*, and the temptation to buy availability with a sharded cluster
you do not need is the main thing this page argues against.

## What is single today

| Component | Replicas | If it dies | State |
| --- | --- | --- | --- |
| **Postgres** | 1 | total outage | the whole site |
| **Redis** | 1 | announces answer, credit stops | swarm state, dedup markers, caches |
| **PgBouncer** | 1 | total outage | none — it is a proxy |
| **Caddy** | 1 | total outage | TLS certificates |
| Web, API, Tracker | N | degraded | none |

PgBouncer and Caddy are the cheap wins and are dealt with at the end. Postgres
and Redis are the interesting ones.

## What the code already gets right

Four properties that would each have been an expensive retrofit. They are worth
naming because they decide how much of the work below is actually left.

**No sequences anywhere.** `grep` for `serial`, `bigserial` or
`generatedAlwaysAsIdentity` in [`schema.ts`](https://github.com/Dim145/opentracker/blob/main/packages/db/src/schema.ts)
returns nothing: every id is random — `randomUUID()` in the API, `NewID()` in
the tracker. There is no sequence to resynchronise after a promotion and no
sequence to collide in an active-active setup. This is the single biggest
enabler on the Postgres side.

**No `LISTEN`/`NOTIFY`.** Nothing in the codebase depends on it, which matters
because notifications do not cross a replication boundary and do not survive a
failover.

**Every advisory lock is transaction-scoped.** All five request-path sites use
`pg_advisory_xact_lock`, never the session variant:

| Site | Lock |
| --- | --- |
| `utils/bonusEvents.ts` | `pg_advisory_xact_lock(BONUS_EVENTS_ADVISORY_LOCK_ID)` |
| `utils/freeleechPool.ts` | `pg_advisory_xact_lock(POOL_ADVISORY_LOCK_ID)` |
| `routes/api/auth/register.post.ts` | `pg_advisory_xact_lock(REGISTER_FIRST_USER_LOCK_ID)` |
| `routes/api/me/templates/index.post.ts` | `pg_advisory_xact_lock(7411, hashtext(user.id))` |

Transaction-scoped locks are released by `COMMIT` or `ROLLBACK`, which is what
makes them safe behind PgBouncer's `POOL_MODE: transaction` — a session-level
lock taken on a pooled connection would leak to whoever got that connection
next. It also means a failover leaves nothing to clean up: the in-flight
transactions are lost, and their locks with them.

**Migrations already serialise across replicas.**
[`scripts/migrate.mjs`](https://github.com/Dim145/opentracker/blob/main/apps/api/scripts/migrate.mjs)
connects via `MIGRATIONS_DATABASE_URL` — deliberately bypassing PgBouncer —
with `max: 1`, and takes `pg_advisory_lock(49192221)` before running the
migrator. Whoever arrives first migrates and the others block, then find the
work done. Adding API replicas does not need anything here.

**The tracker's Redis access is already single-key.** The `setPeerScript` Lua
script touches only `KEYS[1]`; the one `TxPipeline` in
[`peers.go`](https://github.com/Dim145/opentracker/blob/main/apps/tracker/internal/peers/peers.go)
runs `HIncrBy` and `Expire` against the same key. Nothing in the tracker's
keyspace requires two keys to live together.

## Redis

### You asked for a cluster. Sentinel is almost certainly the better answer

Redis Cluster and Redis Sentinel solve different problems, and only one of them
is the problem this stack has.

- **Cluster** shards the keyspace across N primaries and fails over each shard.
  It buys horizontal capacity *and* availability.
- **Sentinel** keeps one primary with replicas and promotes one automatically.
  It buys availability only.

Measured, Redis was at **0.60 of a core while the host was saturated and the
tracker was serving 4 811 announces/s** — 10 % of the server-side CPU, and the
lowest of the three components. Sharding buys capacity that is not the
constraint, at a cost that is entirely real:

| Cluster breaks | Where | Why |
| --- | --- | --- |
| 4 × `SCAN` sweeps | `utils/peerStats.ts`, `plugins/stats-collector.ts` (×2), `plugins/bonus-collector.ts` | `SCAN` enumerates **one node's** keyspace. A sweep of `ot:peers:*` silently returns the keys on one shard and misses the rest — no error, just wrong numbers |
| 1 × `pipeline()` | `utils/peerStats.ts` | ioredis: *"All keys in a pipeline should belong to slots served by the same node, since ioredis sends all commands in a pipeline to the same node."* The keys come from a whole-keyspace scan, so they do not |
| 1 × `multi()` | `utils/rateLimit.ts` | `MULTI` requires one slot |
| 6 × `eval()` | `plugins/ban-expiry.ts`, `plugins/request-auto-validate.ts`, `plugins/freeleech-pool.ts`, `plugins/bonus-collector.ts`, `plugins/federation-sync.ts`, `utils/cronLock.ts` | every key a script touches must hash to the same slot; audit each |
| Client type, TS | `redis/client.ts:79` | `new Redis(url)` → `new Redis.Cluster(nodes)` |
| Client type, Go | 6 sites: `handler.go`, `dedup.go`, `cache.go`, `peers.go`, `bonus.go` | `*redis.Client` → `redis.UniversalClient`, the interface both satisfy |

The `SCAN` row is the one that should decide it. It is not a crash — it is a
silently wrong seeder count on every torrent page, which is exactly the failure
mode this documentation set exists to prevent. The `keyPrefix: 'ot:'` in
`client.ts` does **not** help: a shared prefix does not imply a shared slot,
only a hash tag `{...}` does.

Sentinel preserves every one of those semantics unchanged. One primary, so
`SCAN` sees everything, pipelines span whatever they like, and Lua scripts keep
working.

### What Sentinel does need

Three changes, and one decision.

```
Sentinel quorum of 3 (they can be co-located with the app nodes — they are tiny)
  ├── redis-primary
  └── redis-replica  (replica-read-only yes)
```

1. **API client** — `new Redis(url)` becomes
   `new Redis({ sentinels: [...], name: 'mymaster', password })`. ioredis
   handles the primary discovery and reconnection itself.
2. **Tracker client** — `redis.NewFailoverClient(&redis.FailoverOptions{...})`.
   This returns a `*redis.Client`, so the six fields do **not** need to change
   for Sentinel. They only need to become `redis.UniversalClient` if you later
   want Cluster as well; doing it now costs nothing and keeps the option open.
3. **`enableOfflineQueue: false`** in `redis/client.ts` is the decision.
   Combined with `maxRetriesPerRequest: 3`, every command fails immediately
   while no primary is elected — a Sentinel failover takes roughly 10–30 s, and
   for that window every rate-limit check, cache read and ban lookup rejects.
   The setting exists as command-queue-overflow protection, which is a real
   concern, so this is a genuine trade rather than an oversight. Either raise it
   to a bounded offline queue for the failover window, or keep it and accept
   that a failover is a brief partial outage. Decide it before the failover
   decides for you.

**What a failover window actually costs**, per subsystem, is worth knowing
before choosing:

| Subsystem | During the window |
| --- | --- |
| Peer writes | fail; the announce still answers with the swarm it could read |
| Credit dedup | `checkRedis` returns **true** on error — it degrades to per-process dedup, which is the deliberate single-instance fallback. With several tracker instances behind a balancer, that reopens the double-credit window for the duration |
| Passkey cache | misses fall through to Postgres; correct, just slower |
| Rate limiting | the identity-keyed limiter cannot read its counters |

The dedup row is the one that matters. It is a correctness window, not a
performance one, and it is the argument for keeping the failover short.

### Independent of HA: where the memory ceiling actually sits

Measured on the bench: a peer costs **~290 bytes** in Redis — 226 bytes of JSON
(`peerId`, `userId`, `ip`, `ipHash`, `port`, `uploaded`, `downloaded`, `left`,
`isSeeder`, timestamps) plus the field name and hash overhead. A 200-peer swarm
measured 58 096 bytes with `MEMORY USAGE`.

That puts a number on the ceiling. `docker-compose.prod.yml` allows 512 MB, so
the keyspace runs out of room at roughly **1.7 M concurrent peers** — call it
1.5 M once dedup markers, the passkey cache and the stats hashes are counted.

Where that sits relative to real load depends entirely on the active share. On
the assumptions [Scaling out](./scaling) uses — 25 % of members active, 4
torrents each — 350 000 members means 350 000 concurrent peers, about
**101 MB**: comfortable, with room to spare. Push the active share to 100 % and
the same member count is 1.4 M peers and **406 MB**, which is at the ceiling.

So this is not an emergency at the documented assumptions. It is a limit worth
knowing precisely, because of *how* it fails when it is reached. The production
setting is:

```
--maxmemory 512mb
--maxmemory-policy allkeys-lru
```

**Peer state is not a cache.** Evicting `peers:<hash>` throws away the baseline
the next announce is measured against, and an announce with no previous state
credits nothing — deliberately, because a cumulative counter must never be
treated as a standalone delta. So eviction does not slow the tracker down; it
quietly stops crediting members, which on a private tracker is a ratio problem
and therefore a trust problem. Evicting a dedup marker reopens the
double-credit window on the other side.

Do this regardless of whether you ever add a replica:

- **Size `maxmemory` from the peer count**, not from a round number:
  `concurrent_peers × 300 B × 1.5`. At the documented 25 % active share that
  is ~150 MB and 512 MB is already generous; at a 60 % share it is ~365 MB and
  512 MB is not.
- **Alarm at 70 % of `maxmemory`.** Reaching the policy at all is an incident,
  not a steady state.
- **Prefer `volatile-lru`.** Every key the tracker writes has a TTL, so the
  practical behaviour is close to `allkeys-lru`, but it states the intent and it
  protects anything added later without one.
- If the two roles ever diverge in size, **split the keyspaces**: an
  authoritative instance at `noeviction` and a cache instance at
  `allkeys-lru`. Failing loudly on the authoritative one is better than
  under-crediting silently.

## Postgres

### HA here means one primary and automatic promotion

Not multi-primary. Nothing in this stack needs multi-primary, and the write path
— `UPDATE users SET uploaded = uploaded + $1` — is exactly the shape that makes
active-active a conflict-resolution project rather than a deployment.

Read replicas are worth being explicit about too: **they would not buy
capacity.** Postgres executes 0.375 ms per announce, and there is no read/write
routing in the codebase — a single `DATABASE_URL` reaches
[`packages/db/src/index.ts`](https://github.com/Dim145/opentracker/blob/main/packages/db/src/index.ts).
A replica earns its place as a *standby to promote*, and secondarily as
somewhere to run heavy admin and statistics queries away from the announce path.
Not as a way to serve more announces.

The three mature options, and how they fit a Docker Compose stack:

The Helm chart in [Kubernetes](./kubernetes) already runs the CloudNativePG
option, including the operator-managed pooler that fixes the static-host problem
below.

| Option | Fits | Notes |
| --- | --- | --- |
| **Patroni** + etcd + HAProxy | 3+ nodes, VMs or Compose | the industry standard; needs a real quorum, so three nodes minimum |
| **pg_auto_failover** | exactly 2 nodes | purpose-built for two, but the monitor is itself a single point of failure, and giving it a standby closes the complexity gap with Patroni |
| **CloudNativePG** | Kubernetes only | the operator replaces Patroni, etcd *and* HAProxy; promotes the replica with the highest LSN; ~5–10 s failover |

This stack is Compose, so the realistic choice is Patroni with three nodes, or
moving Postgres to Kubernetes or a managed service.

### The adaptations this stack needs

**1. PgBouncer's target is static.** `DB_HOST: postgres` in
`docker-compose.prod.yml` names one container. After a promotion it must point
at the new primary. The standard pattern is HAProxy in front of Patroni's REST
health endpoints, with PgBouncer pointing at HAProxy:

```
api ──┐
      ├── pgbouncer ── haproxy ── patroni{1,2,3} ── postgres{1,2,3}
tracker ┘                  (health-checked: only the primary is up)
```

**2. `MIGRATIONS_DATABASE_URL` bypasses PgBouncer by design** — it must follow
the primary too, and it cannot go through the read-write health check by
accident. And note the one genuinely nasty case: the boot migration holds a
*session*-level advisory lock, so a promotion in the middle of a migration
loses the lock along with the connection and can leave a partly-applied
migration. Take a backup before an upgrade that includes migrations, which
[Upgrading](./upgrading) already says, and do not upgrade during a failover.

**3. `postgres.js` does not find the primary for you.** The API's client
(`postgres(connectionString, ...)`) takes one connection string. It has no
`target_session_attrs=read-write` equivalent, so it cannot be handed a list of
hosts and be trusted to pick the writable one — that is precisely why the
HAProxy hop above exists rather than a client-side host list. The Go side is
different: pgx *does* support multi-host DSNs with `target_session_attrs`, so
the tracker could skip the proxy if you wanted it to. Keeping both on the same
path is worth more than saving the tracker one hop.

**4. Verify prepared statements against the new hop.** `packages/db/src/index.ts`
sets `prepare: true` and connects through PgBouncer in `transaction` mode. That
combination needs PgBouncer ≥ 1.21 with `max_prepared_statements > 0`, and the
Compose file does not set it. It works today; adding a proxy layer is exactly
the kind of change that surfaces this, so confirm it deliberately rather than
discovering it during a failover.

**5. Decide what `synchronous_commit` means with a standby.** The tracker sets
`synchronous_commit=off` on its own connections
(`TRACKER_SYNCHRONOUS_COMMIT`, see [Scaling out](./scaling)). With an
asynchronous standby, an announce delta can now be lost twice over — once
because the local commit did not wait for its own WAL flush, and again because
the standby had not received it. That is defensible for announce deltas and
indefensible for a password change, which is why the setting is per-connection.
If you add a **synchronous** standby, be aware that `off` opts the tracker out
of waiting for it as well. `remote_write` is the middle ground: wait for the
standby to receive the WAL, but not for either side to fsync.

**6. Size the replication link from the WAL rate.** ~890 bytes of WAL per
credited announce is **15 GB/day at 200 announces/s**. That is the standby's
bandwidth, the archive's growth, and the reason `wal_compression = on` is in the
recommended configuration.

## PgBouncer and Caddy

The cheap half of this page.

**PgBouncer is stateless** — a userspace proxy holding no data. Run two and put
them behind the same mechanism that finds the primary. The only thing to keep in
mind is that pool sizes multiply: `DEFAULT_POOL_SIZE: 20` × 2 instances against
`max_connections` on the primary, plus the tracker's own pgx pool
(`TRACKER_DB_MAX_CONNS`, default 20) × its instance count. Sum the pools, do not
estimate them.

**Caddy holds one thing that matters**: the TLS certificates and their ACME
account. Two instances need either shared storage for `caddy_data` or a
distributed certificate store, otherwise both will try to solve ACME challenges
independently and rate-limit you out. Two Caddy instances behind DNS round-robin
or a layer-4 balancer is straightforward once that is settled.

Note that UDP announces already need a layer-4 balancer with client-IP
affinity — see [Scaling out](./scaling) — so if UDP is enabled, that balancer is
the natural place for the HTTP frontends too.

## What is optimal

Four tiers. The honest recommendation is not the highest one.

| Tier | What | RTO | RPO | Cost |
| --- | --- | --- | --- | --- |
| **0 — today** | single everything, `restart: always` | manual, tens of minutes | last backup | none |
| **1** | Postgres streaming standby + Redis replica, **manual** promotion; PgBouncer ×2 | minutes | seconds | one extra host |
| **2** | Patroni ×3 + etcd ×3 + HAProxy; Redis Sentinel ×3; Caddy ×2 | ~30 s | seconds | three hosts, real operational load |
| **3** | Kubernetes, CloudNativePG, a Redis operator | ~10 s | seconds | a platform |

**Tier 1 is the recommendation for a 350 000-member instance.** The measurements
are the argument: Postgres runs the announce path in 0.375 ms and half a core,
Redis in 0.60 of a core. Nothing here is straining. What Tier 1 buys is that a
dead disk stops being a restore-from-backup afternoon, and it buys it with one
extra host and no new consensus system to operate.

Tier 2 is the right answer when someone is on call and the failover is tested on
a schedule. Automatic failover that has never been rehearsed is a liability, not
a feature: a split brain writing to two primaries with `synchronous_commit=off`
loses announce deltas on whichever side gets demoted, and nothing in the
application will notice.

Two things worth doing before any of it, because they cost almost nothing and
pay off at every tier:

1. **Derive the Redis `maxmemory` from your actual peer count** rather than
   leaving it at 512 MB, and alarm on it. The measured 290 B per peer makes that
   a one-line calculation, and the failure mode — silently crediting nothing —
   is one no amount of replication fixes.
2. **Rehearse the restore you already have.** [Backup & Restore](./backup-restore)
   documents it; an untested restore and no HA is a worse position than a tested
   restore and no HA, and it is the same amount of hardware.
