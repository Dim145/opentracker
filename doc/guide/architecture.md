# Architecture

Trackarr ships as **three independent containers** behind Caddy,
plus the usual Postgres + Redis pair. They share zero process state
— Redis is the only cross-cutting bus.

```
                              ┌───────────────────────────────────┐
   Browser ──HTTPS──►   Caddy │ /announce  → tracker (Go) :8080   │
                              │ /api/*     → api (Nitro)          │
                              │ /uploads/* → api (Nitro)          │
                              │ /*         → web (Nuxt SSR)       │
                              └───────────────────────────────────┘
   BT client  ──UDP──► tracker :6969  (BEP 15, bypasses Caddy — UDP can't be reverse-proxied)
                                  │            │           │
                                  ▼            ▼           ▼
                       ┌─────────────┐ ┌─────────────┐ ┌──────────────┐
                       │  apps/web   │ │  apps/api   │ │ apps/tracker │
                       │  Nuxt 4 SSR │ │ Nitro 4     │ │ Go 1.25      │
                       │  Vue 3      │ │ Drizzle ORM │ │ sqlc         │
                       │  TypeScript │ │ Zod, h3     │ │ HTTP + UDP   │
                       └─────────────┘ └──────┬──────┘ └──────┬───────┘
                                              │              │
                                              ▼              ▼
                                       ┌─────────────────────────┐
                                       │   PgBouncer (pool)      │
                                       └────────────┬────────────┘
                                                    │
                                              ┌─────▼─────┐
                                              │ Postgres  │
                                              └───────────┘
                                              ┌───────────┐
                                              │   Redis   │ ◄── tracker peers,
                                              └───────────┘     sessions, rate limit,
                                                                seed-bonus accumulator
```

## Why three containers

### The tracker is its own thing

It's the hot path — every BitTorrent client in the swarm hits
`/announce` every few minutes. Rewriting it from Node.js to a
static Go binary on `scratch` (~10 MB image, sub-ms p99) means a
single broken Nuxt deploy can't take down announces, and the
announce path doesn't pay V8 startup costs. The Go module uses
`sqlc` for type-safe DB access; the announce protocol talks to
the same Redis hashes Node used to write, so callers don't change.

**Two transports**: BEP 3 over HTTP/8080 and BEP 15 over UDP/6969 —
same wire-agnostic processor, different parsers/encoders. The UDP
frontend uses a stateless HMAC-bound `connection_id` and pulls the
passkey out of the BEP 41 URL_DATA option
(`udp://host:6969/announce/PASSKEY`). See the
[UDP tracker guide](./udp-tracker.md) for the protocol details.

### The API and the web are split

`apps/api` is Nitro standalone — every `/api/*` route, the upload
endpoints, the metadata lookups, the admin tools. `apps/web` is
Nuxt SSR — the rendered shell + page chunks. The split lets each
scale and redeploy independently, and the static-build alternative
(see [Local production](./local-production.md#static-spa-variant))
replaces only `apps/web`.

### Distroless everywhere

| Container | Base image |
| --- | --- |
| `apps/web` (SSR) | `gcr.io/distroless/nodejs24-debian13:nonroot` |
| `apps/web` (static) | `cgr.dev/chainguard/nginx` |
| `apps/api` | `gcr.io/distroless/nodejs24-debian13:nonroot` |
| `apps/tracker` | `scratch` |

No shells, no package managers, signed images, non-root by default.

## Data layer

| Store | Purpose |
| --- | --- |
| **Postgres** | All persistent state — users, torrents, sessions, bonus ledger, notification rows. Schema in `packages/db/src/schema.ts`, applied at API boot via `drizzle-kit push --force`. |
| **PgBouncer** | Connection pool between the API and Postgres. The api fans out a handful of connections per request handler; PgBouncer keeps the per-Postgres-backend count bounded. |
| **Redis** | The peer store (one hash per torrent), sessions, rate-limit windows, the seed-bonus accumulator, the in-app notification pub/sub fan-out, and a few opportunistic caches (metadata, channel-encryption-key). The Go tracker and the Nitro API agree on a shared `REDIS_KEY_PREFIX` so both see the same keyspace. |

## Cross-cutting concerns

- **Sessions** — h3 sealed cookie (iron-webcrypto), 7-day TTL,
  HttpOnly + SameSite=lax. Encryption key from `NUXT_SESSION_SECRET`.
- **Notification fan-out** — every event-emitting route calls
  `notify(userId, type, payload, link)`. The row hits Postgres,
  then a Redis pub/sub broadcast lets every Nitro replica with
  the user's SSE stream open push the row in real time, then a
  separate fan-out delivers through the user's chosen external
  channel (SMTP / Telegram / Discord / Web Push / …).
- **Bonus collector** — a Nitro plugin cron in `apps/api/plugins`
  scans the Redis peer hashes once an hour, computes seed-time
  deltas, and credits `users.bonus_points` through the
  `bonus_grants` ledger. A cross-replica Redis lock + persisted
  last-tick timestamp ensure exactly one tick fires across the
  fleet per `BONUS_COLLECTION_INTERVAL`, regardless of restarts.
- **Panic mode** — operator-triggered AES-256-GCM column-level
  encryption of every sensitive field. The panic key never lands
  on disk; recovery requires the operator to re-enter it. See
  [Panic Mode](./panic-mode.md).

## Deployment topology

The default production stack is one of each container per host,
behind Caddy. Horizontal scale is supported for the API and web —
both are stateless against Redis + Postgres — but the tracker is
typically pinned to a single host so the UDP socket isn't
duplicated across instances.

See [Local production](./local-production.md) for the
docker-compose recipe (real deploys use the same `prod.yml`).
