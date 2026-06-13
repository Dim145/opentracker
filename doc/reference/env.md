# Environment variables

Authoritative list of every environment variable read by Trackarr at runtime —
sourced directly from the three application binaries (`apps/api`, `apps/web`,
`apps/tracker`) and the shared `packages/db` connector.

The compose files (`docker-compose.prod.yml`, `docker-compose.loadtest.yml`,
`docker-compose.static.yml`) and the Caddyfile read a few **operator-side**
variables on top — those are flagged in the *Read by* column.

::: tip Generate secrets
Anything marked *required* in the *Default* column must be set explicitly. The
recommended way is `openssl rand -hex 32` (32-byte hex string, 64 chars).
:::

## Required

The application refuses to start without these. The tracker (Go binary) prints
`FATAL: <var> is required` and exits non-zero; the API throws on boot.

| Variable                | Read by         | Purpose                                                                                       |
| ----------------------- | --------------- | --------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | api, tracker    | PostgreSQL DSN. In compose this points at PgBouncer (`postgres://…@pgbouncer:6432/…`).        |
| `REDIS_URL`             | api, tracker    | Redis DSN. `redis://` or `rediss://` for TLS. Pair with `REDIS_PASSWORD` when needed.         |
| `IP_HASH_SECRET`        | api, tracker    | Daily-rotated salt for SHA-256 peer-IP fingerprinting. Also keys the UDP `connection_id` HMAC.|
| `NUXT_SESSION_SECRET`   | api, web        | h3 sealed-cookie key (iron-webcrypto). 32+ chars. Fallback for `CHANNEL_ENCRYPTION_KEY`.      |
| `ADMIN_API_KEY`         | api             | Bearer token for internal admin endpoints. The API returns `503` while it is unset.           |

## Application & runtime

| Variable           | Read by             | Default                  | Purpose                                                              |
| ------------------ | ------------------- | ------------------------ | -------------------------------------------------------------------- |
| `NODE_ENV`         | api, web, compose   | `development`            | Toggles production-grade defaults (log level, error masking, TLS).   |
| `NITRO_PORT`       | api (compose)       | `4000`                   | Nitro listener port inside the API container.                        |
| `NITRO_HOST`       | api (compose)       | `0.0.0.0`                | Bind interface.                                                      |
| `TZ`               | api (compose)       | `Europe/Paris`           | Container timezone — used for `bonus_grants.created_at` and similar. |
| `LOG_LEVEL`        | api                 | `info` (prod), `debug`   | `trace`/`debug`/`info`/`warn`/`error`. Wires into the slog handler.  |
| `UPLOADS_DIR`      | api                 | `./data/uploads`         | Filesystem root for logos, favicons, NFOs. Inside the API container. |
| `API_INTERNAL_URL` | web                 | `http://api:4000`        | Used by Nuxt SSR to fetch from the API across the docker network.    |
| `IMAGE_TAG`        | compose             | `latest`                 | GHCR tag pulled by `docker-compose.prod.yml`. Pin in production.     |

## Database (PostgreSQL)

`DATABASE_URL` is the canonical DSN. The split `DB_*` variables are read only
by **compose** to render the URL and pass `POSTGRES_*` to the postgres image —
the running app never reads them directly.

| Variable                      | Read by   | Default       | Purpose                                                                |
| ----------------------------- | --------- | ------------- | ---------------------------------------------------------------------- |
| `DATABASE_URL`                | api, tracker | —          | PostgreSQL DSN. **Required**.                                          |
| `MIGRATIONS_DATABASE_URL`     | api       | `DATABASE_URL`| Direct postgres DSN (bypasses PgBouncer) used by `drizzle-kit push`.   |
| `DB_USER`                     | compose   | `tracker`     | Postgres role; renders into the DSN.                                   |
| `DB_PASSWORD`                 | compose   | `tracker`     | Postgres password; renders into the DSN.                               |
| `DB_NAME`                     | compose   | `trackarr`    | Database name.                                                         |
| `DB_PORT`                     | compose   | `5432`        | Listener port (host side).                                             |
| `DB_POOL_MAX`                 | api       | `10`          | `pg.Pool` size per Nitro worker.                                       |
| `DB_SSL`                      | api       | `true` (prod) | `true`/`false`. Forces `pg.ssl` regardless of `NODE_ENV`.              |
| `DB_SSL_REJECT_UNAUTHORIZED`  | api       | `true`        | Disable cert validation when set to `false`.                           |
| `DB_SSL_CA`                   | api       | unset         | Inline PEM CA bundle (escape newlines as `\n`).                        |
| `DB_DEBUG`                    | api       | `false`       | When `true`, Drizzle logs every query.                                 |

## Redis

| Variable                        | Read by      | Default                    | Purpose                                                              |
| ------------------------------- | ------------ | -------------------------- | -------------------------------------------------------------------- |
| `REDIS_URL`                     | api, tracker | —                          | DSN. **Required**.                                                   |
| `REDIS_PASSWORD`                | api, tracker | unset                      | When set, used in the URL or as an `AUTH` argument.                  |
| `REDIS_KEY_PREFIX`              | api, tracker | `ot:`                      | Namespace for every key. Must match across api ⇄ tracker.            |
| `REDIS_TLS`                     | api          | `false`                    | `true` forces TLS even when the URL scheme is `redis://`.            |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | api          | `true`                     | Disable cert validation when set to `false`.                         |
| `REDIS_TLS_CA`                  | api          | unset                      | Inline PEM CA bundle for Redis TLS.                                  |
| `REDIS_TLS_CA_FILE`             | api          | unset                      | Path to a CA bundle file (overrides `REDIS_TLS_CA`).                 |
| `REDIS_TLS_CERT_FILE`           | api          | unset                      | Path to a client certificate (mTLS).                                 |
| `REDIS_TLS_KEY_FILE`            | api          | unset                      | Path to the matching client key (mTLS).                              |

## Tracker (Go binary)

| Variable                       | Read by      | Default                          | Purpose                                                                |
| ------------------------------ | ------------ | -------------------------------- | ---------------------------------------------------------------------- |
| `TRACKER_HTTP_PORT`            | tracker      | `8080`                           | BEP 3 (HTTP) announce port.                                            |
| `TRACKER_UDP_PORT`             | tracker      | `6969`                           | BEP 15 (UDP) announce port.                                            |
| `TRACKER_UDP_ENABLED`          | tracker, api | `true`                           | Toggles the UDP listener **and** UDP-tier inclusion in `.torrent` downloads. Three processes read this: the tracker (listener), the API stats endpoint (`/api/stats/public`), and `/api/torrents/:hash/download`. |
| `TRACKER_DEBUG`                | tracker      | `false`                          | Verbose announce + dispatch logging.                                   |
| `TRACKER_PEER_TTL`             | tracker      | `24h`                            | How long a peer's Redis entry survives between announces. Go duration syntax (`24h`, `90m`, `7200s`). Values below `15m` are clamped — anything shorter would zero the delta computation. Raise it for very forgiving deployments; lower it on huge swarms to reclaim Redis memory. |
| `TRACKER_INTERNAL_URL`         | api          | `http://tracker:8080`            | Internal URL the API hits for `/api/tracker-health`.                   |
| `TRACKER_HEALTH_URL`           | api          | `TRACKER_INTERNAL_URL`           | Override the health-probe URL specifically.                            |
| `TRUST_PROXY`                  | api, tracker | `false`                          | Honour `X-Forwarded-For` / `X-Real-IP` for client IP. Set to `true` only behind a *trusted* reverse proxy. The rightmost token is used (the one your proxy appended). |
| `TRUST_CF_CONNECTING_IP`       | api, tracker | `false`                          | Honour `CF-Connecting-IP`. Keep `false` unless fronted by **Cloudflare** with ingress locked to its IP ranges — otherwise the header is client-spoofable (the Caddyfile strips it by default) and trusting it bypasses IP bans/rate limits. Requires `TRUST_PROXY=true`. |
| `NUXT_PUBLIC_TRACKER_HTTP_URL` | api, web     | `http://localhost:8080/announce` | Announce URL embedded in `.torrent` files (runtime).                   |
| `NUXT_PUBLIC_TRACKER_UDP_URL`  | api, web     | unset                            | UDP tier added when `TRACKER_UDP_ENABLED=true` and this URL is set.    |
| `NUXT_PUBLIC_TRACKER_WS_URL`   | api, web     | unset                            | Reserved; WebTorrent (wss) is **not** implemented yet — don't advertise it. |

::: tip Tracker tunables aren't env-driven
Announce interval (`1800` s), min interval (`900` s) and per-response peer cap
(`50` HTTP / `100` UDP) are hard-coded in
`apps/tracker/internal/server/response.go`. Rebuild the binary if you need to
change them.
:::

## Security & sessions

| Variable                  | Read by | Default                          | Purpose                                                              |
| ------------------------- | ------- | -------------------------------- | -------------------------------------------------------------------- |
| `NUXT_SESSION_SECRET`     | api, web| —                                | **Required**. h3 sealed-cookie key. 32+ chars.                       |
| `IP_HASH_SECRET`          | api, tracker | —                           | **Required**. Salt for IP fingerprints + UDP connection-id HMAC.    |
| `ADMIN_API_KEY`           | api     | —                                | **Required**. Bearer token for internal admin endpoints.            |
| `CHANNEL_ENCRYPTION_KEY`  | api     | falls back to `NUXT_SESSION_SECRET` | AES key for notification-channel configs at rest (SMTP password, Telegram token, VAPID private key). Generate with `openssl rand -hex 32`. |
| `TRUST_PROXY`             | api, tracker | `false`                     | See *Tracker* — same flag, same semantics, same caveats.            |
| `TRUST_CF_CONNECTING_IP`  | api, tracker | `false`                     | See *Tracker* — only enable behind Cloudflare with locked ingress.  |
| `SAFE_FETCH_ALLOW_HOSTS`  | api     | — (empty)                        | Comma-separated exact hostnames allowed to bypass the SSRF private/loopback block. Needed only to federate with a peer reachable over a private network (LAN / VPN / docker service name). List trusted peer hosts only; empty leaves SSRF protection unchanged. |

## Two-factor auth & WebAuthn

| Variable          | Read by | Default                | Purpose                                                                  |
| ----------------- | ------- | ---------------------- | ------------------------------------------------------------------------ |
| `TRACKARR_NAME`   | api     | `Trackarr`             | Display name shown by authenticator apps as the TOTP issuer **and** the WebAuthn RP name. |
| `WEBAUTHN_RP_ID`  | api     | inferred from `Origin` | Passkey-bound hostname. Pin explicitly behind a load balancer.           |
| `WEBAUTHN_ORIGIN` | api     | inferred from `Origin` | Origin allow-list for assertions.                                        |

The *Force 2FA* enforcement scope (off / staff / all) is configured at runtime
in `/admin/settings` and persisted to the `settings` table, not via env.

## Metadata providers

All optional. Without a key, the matching source returns `503` for lookup
routes and the upload picker simply hides the column.

| Variable               | Read by | Default | Purpose                                                                                     |
| ---------------------- | ------- | ------- | ------------------------------------------------------------------------------------------- |
| `TMDB_API_KEY`         | api     | unset   | TMDb v3 key **or** v4 Read-Only Access Token (auto-detected). Films + TV.                   |
| `IGDB_ID`              | api     | unset   | Twitch Client ID. Required to enable the IGDB games source. Pair with `IGDB_SECRET`.        |
| `IGDB_SECRET`          | api     | unset   | Twitch Client Secret. Used to mint the IGDB app-access token (cached ~60 days).             |
| `GOOGLE_BOOKS_API_KEY` | api     | unset   | Fallback for the Open Library books source. Open Library itself needs no key.               |

## Notifications

The in-app feed (`/notifications` + bell) always works. External transports
(SMTP, Telegram, Discord, ntfy, Web Push, …) are configured in
`/admin/notifications` and persisted encrypted in `notification_channels` —
no env vars beyond `CHANNEL_ENCRYPTION_KEY`.

The three webhook URLs below are **operator alerts** for the API process
itself (admin/security events), not user-facing notification channels.

| Variable                 | Read by | Default | Purpose                                                                  |
| ------------------------ | ------- | ------- | ------------------------------------------------------------------------ |
| `DISCORD_WEBHOOK_URL`    | api     | unset   | Webhook target for operator alerts emitted by `apps/api/utils/alerts.ts`. |
| `SLACK_WEBHOOK_URL`      | api     | unset   | Same, Slack-shaped payload.                                              |
| `SECURITY_WEBHOOK_URL`   | api     | unset   | Same, generic security webhook (custom integrations).                    |
| `ENABLE_DEV_ALERTS`      | api     | `false` | When `NODE_ENV !== 'production'`, alerts are dropped unless this is `true`. |

## Background jobs

| Variable                     | Read by | Default      | Purpose                                                                |
| ---------------------------- | ------- | ------------ | ---------------------------------------------------------------------- |
| `BONUS_COLLECTION_INTERVAL`  | api     | `3600000`    | Bonus-collector tick period (ms). Cross-replica SETNX lock; persisted last-tick timestamp ensures exactly one tick across the fleet. |
| `STATS_COLLECTION_INTERVAL`  | api     | `3600000`    | `site_stats` snapshot period (ms). Same lock model.                    |
| `BAN_EXPIRY_INTERVAL`        | api     | `300000`     | Ban-expiry cron tick (ms). Sweeps `is_banned=true AND banned_until<NOW()` and fires `account_unbanned`. SETNX lock. |
| `REQUEST_AUTO_VALIDATE_INTERVAL` | api | `600000`     | Upload-request auto-validate cron tick (ms). Pays the filler when a request sits in `filled` past the admin-tuned timeout. SETNX lock. |

## Prometheus metrics

The metrics listener is opt-in and binds its **own port** — firewall it
independently of the public API.

| Variable                | Read by | Default     | Purpose                                                              |
| ----------------------- | ------- | ----------- | -------------------------------------------------------------------- |
| `METRICS_ENABLED`       | api     | `false`     | Master switch (`true`/`1`/`on`/`yes`).                               |
| `METRICS_HOST`          | api     | `0.0.0.0`   | Bind address.                                                        |
| `METRICS_PORT`          | api     | `9090`      | Bind port.                                                           |
| `METRICS_PATH`          | api     | `/metrics`  | Scrape path.                                                         |
| `METRICS_AUTH_TOKEN`    | api     | unset       | When set, scrapes must present `Authorization: Bearer <token>`.      |
| `METRICS_PEER_CACHE_MS` | api     | `30000`     | TTL of the cached Redis SCAN over `peers:*` used by the gauge.       |

See [Prometheus Metrics reference](./metrics.md) for the gauge list and example
PromQL.

## System metadata (`/api/admin/system/*`)

| Variable           | Read by | Default          | Purpose                                                              |
| ------------------ | ------- | ---------------- | -------------------------------------------------------------------- |
| `TRACKARR_REPO`    | api     | `Dim145/opentracker` | Git repo (`owner/repo`) used by `/api/admin/system/update` to query GitHub for newer tags. |
| `TRACKARR_RUNTIME` | api     | `native`         | Set to `docker` inside containers so the admin dashboard renders the right "running in" badge. |
| `APP_VERSION`      | api     | inherited from `package.json` | Override the version reported by `/api/admin/system/version`. |

## Static SPA build (build-time)

When building the static frontend (`apps/web/Dockerfile.static`,
`docker-compose.static.yml`):

| Variable                       | Default | Purpose                                                              |
| ------------------------------ | ------- | -------------------------------------------------------------------- |
| `NUXT_STATIC_BUILD`            | `false` | When `true`, `nuxi generate` produces the SPA bundle (no SSR).       |
| `NUXT_PUBLIC_TRACKER_HTTP_URL` | unset   | Build-time fallback. The runtime value is fetched from `/api/runtime-config` on boot, so the same image works across domains. |
| `NUXT_PUBLIC_TRACKER_UDP_URL`  | unset   | Build-time fallback (same mechanism).                                |

## Caddy & TLS (compose-only)

| Variable          | Read by | Default            | Purpose                                                              |
| ----------------- | ------- | ------------------ | -------------------------------------------------------------------- |
| `DOMAIN`          | caddy   | `localhost`        | Main hostname; renders into the Caddyfile vhost block.               |
| `TRACKER_DOMAIN`  | caddy   | `tracker.localhost`| Subdomain dedicated to announce traffic (also serves `/announce`).   |
| `ACME_EMAIL`      | caddy   | `admin@example.com`| Let's Encrypt registration email.                                    |

## Removed / deprecated

These were read by previous versions and **no longer have any effect**. If
you carry them over from a `<= v0.5.x` `.env`, delete them — the new code
ignores them silently and that's confusing.

- `TRACKER_HTTP_URL`, `TRACKER_UDP_URL`, `TRACKER_WS_URL` → replaced by the `NUXT_PUBLIC_*` variants
- `NUXT_PUBLIC_SITE_NAME`, `NUXT_PUBLIC_SITE_URL` → site title/URL are now in the `settings` table, edited from `/admin/settings`
- `NUXT_PUBLIC_ANNOUNCE_URL` → use `NUXT_PUBLIC_TRACKER_HTTP_URL`
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST`, `POSTGRES_PORT` → renamed to `DB_*` to match the compose surface
- `PORT` → was never a real default; the API binds `NITRO_PORT` (`4000`)

## Example `.env`

A minimum-viable production `.env`:

```bash
# Domain + TLS
DOMAIN=tracker.example.com
TRACKER_DOMAIN=tracker.example.com
ACME_EMAIL=admin@example.com

# Secrets — generate each with `openssl rand -hex 32`
NUXT_SESSION_SECRET=...
IP_HASH_SECRET=...
ADMIN_API_KEY=...
CHANNEL_ENCRYPTION_KEY=...

# Database
DB_USER=tracker
DB_PASSWORD=...
DB_NAME=trackarr

# Redis
REDIS_PASSWORD=...

# Announce URLs surfaced in .torrent files
NUXT_PUBLIC_TRACKER_HTTP_URL=https://tracker.example.com/announce
NUXT_PUBLIC_TRACKER_UDP_URL=udp://tracker.example.com:6969/announce

# Optional metadata sources
# TMDB_API_KEY=...
# IGDB_ID=...
# IGDB_SECRET=...
# GOOGLE_BOOKS_API_KEY=...
```

::: warning Never commit `.env`
Add it to `.gitignore` (already done in the repo). Use `.env.example` as the
template for documentation and CI.
:::

## Federation

Inter-instance federation is **opt-in** — off until the owner enables it in
`/admin/federation`. It introduces no _required_ variables: the instance's
Ed25519 private key is encrypted with the same key as notification-channel
secrets (`CHANNEL_ENCRYPTION_KEY`, falling back to `NUXT_SESSION_SECRET`).

| Variable                   | Read by | Default           | Purpose                                                                              |
| -------------------------- | ------- | ----------------- | ------------------------------------------------------------------------------------ |
| `FEDERATION_SYNC_INTERVAL` | api     | `900000` (15 min) | Catalogue-sync cron period in ms. The cron is a no-op while federation is disabled.  |
| `TRACKER_FEDERATION_SWARM` | tracker | `false`           | Master switch for swarm cross-announce on the Go tracker. Leave off unless you've deliberately enabled opt-in swarm federation. |

See the [Federation guide](/guide/federation) for the full feature, trust model and security notes.

> [!NOTE]
> Outbound federation calls go through the SSRF-hardened `safeFetch`, which
> blocks loopback and private IP ranges. Federating two instances on the same
> LAN/host therefore needs public hostnames (an explicit host allow-list is not
> implemented yet).
