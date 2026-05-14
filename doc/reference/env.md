# Environment Variables

Complete reference for all environment variables used by Trackarr.

## Required Variables

These must be set for the application to run:

| Variable                | Description                        | Example                               |
| ----------------------- | ---------------------------------- | ------------------------------------- |
| `DATABASE_URL`          | PostgreSQL connection string       | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL`             | Redis connection string            | `redis://:password@host:6379`         |
| `NUXT_SESSION_PASSWORD` | Session encryption key (32+ chars) | Random string                         |
| `TRACKER_SECRET`        | Secret for passkey generation      | Random string                         |
| `IP_HASH_SECRET`        | Secret for IP hashing              | Random string                         |

## Application Settings

| Variable                   | Description                  | Default       |
| -------------------------- | ---------------------------- | ------------- |
| `NUXT_PUBLIC_SITE_NAME`    | Display name of your tracker | `Trackarr`    |
| `NUXT_PUBLIC_SITE_URL`     | Public URL                   | —             |
| `NUXT_PUBLIC_ANNOUNCE_URL` | Announce URL for torrents    | —             |
| `NODE_ENV`                 | Environment mode             | `development` |
| `PORT`                     | Application port             | `3000`        |

## Database

| Variable            | Description         | Default     |
| ------------------- | ------------------- | ----------- |
| `POSTGRES_USER`     | PostgreSQL username | `tracker`   |
| `POSTGRES_PASSWORD` | PostgreSQL password | —           |
| `POSTGRES_DB`       | Database name       | `trackarr`  |
| `POSTGRES_HOST`     | Database host       | `localhost` |
| `POSTGRES_PORT`     | Database port       | `5432`      |

## Redis

| Variable         | Description    | Default     |
| ---------------- | -------------- | ----------- |
| `REDIS_HOST`     | Redis host     | `localhost` |
| `REDIS_PORT`     | Redis port     | `6379`      |
| `REDIS_PASSWORD` | Redis password | —           |

## Security

| Variable            | Description                     | Default           |
| ------------------- | ------------------------------- | ----------------- |
| `POW_DIFFICULTY`    | Proof of Work difficulty (1-10) | `5`               |
| `RATE_LIMIT_WINDOW` | Rate limit window (seconds)     | `60`              |
| `RATE_LIMIT_MAX`    | Max requests per window         | `100`             |
| `SESSION_MAX_AGE`   | Session lifetime (seconds)      | `604800` (7 days) |

## Tracker

| Variable               | Description                     | Default |
| ---------------------- | ------------------------------- | ------- |
| `TRACKER_HTTP_PORT`    | HTTP listener port (BEP 3 announce) | `8080` |
| `TRACKER_UDP_PORT`     | UDP listener port (BEP 15 announce) | `6969` |
| `TRACKER_UDP_ENABLED`  | Toggle the UDP listener. Read by **three** processes: the tracker (controls the listener), the API stats endpoint (drives the homepage Protocol-health tile), and the `.torrent` download endpoint (only adds the UDP tier when this is true). | `true` |
| `TRACKER_INTERVAL`     | Announce interval (seconds)     | `1800`  |
| `TRACKER_MIN_INTERVAL` | Minimum announce interval       | `900`   |
| `TRACKER_MAX_PEERS`    | Max peers returned per announce | `50`    |
| `TRACKER_DEBUG`        | Enables `debug` logs on the tracker container (announce successes, UDP packet dispatch, …). | `false` |
| `TRUST_PROXY`          | Honour `X-Forwarded-For` for client IP. Set to `true` only when a trusted reverse proxy is in front of the tracker. | `false` |
| `REDIS_KEY_PREFIX`     | Prefix every Redis key with this string. Must match between the API (ioredis) and the Go tracker. | `ot:`   |

::: tip UDP frontend
Disabling UDP at the tracker (`TRACKER_UDP_ENABLED=false`) automatically
keeps the UDP tier out of newly downloaded `.torrent` files — the API
reads the same env. See the [UDP Tracker guide](../guide/udp-tracker)
for the protocol details, the BEP 41 passkey scheme, and reverse-proxy
caveats.
:::

## Static SPA build (optional)

Set when building the Nuxt static bundle (`apps/web/Dockerfile.static`):

| Variable                     | Description                                                          | Default |
| ---------------------------- | -------------------------------------------------------------------- | ------- |
| `NUXT_STATIC_BUILD`          | When `true`, `nuxi generate` produces a fully static SPA (no SSR).    | `false` |
| `NUXT_PUBLIC_TRACKER_HTTP_URL` | Tracker HTTP announce URL surfaced in the user's announce URL.    | —       |
| `NUXT_PUBLIC_TRACKER_UDP_URL`  | UDP announce URL.                                                  | —       |
| `NUXT_PUBLIC_TRACKER_WS_URL`   | WebSocket announce URL.                                            | —       |

The static bundle reads the runtime tracker URLs from `/api/runtime-config` on
boot, so the build-time values above are only fallbacks. The same image is
portable across domains.

## Prometheus metrics

| Variable                 | Description                                                  | Default     |
| ------------------------ | ------------------------------------------------------------ | ----------- |
| `METRICS_ENABLED`        | Master switch. `true`/`1`/`on`/`yes` enables the listener.   | `false`     |
| `METRICS_HOST`           | Bind address.                                                | `0.0.0.0`   |
| `METRICS_PORT`           | Bind port.                                                   | `9090`      |
| `METRICS_PATH`           | Scrape path.                                                 | `/metrics`  |
| `METRICS_AUTH_TOKEN`     | Optional. When set, scrapes must present `Authorization: Bearer <token>`. | unset |
| `METRICS_PEER_CACHE_MS`  | TTL of the cached Redis SCAN over `peers:*`.                 | `30000`     |

See the [Prometheus Metrics reference](./metrics.md) for the full list of
exposed gauges and example queries.

## Media metadata

All three providers are optional. Without them, torrents still get a
poster + title from the user-supplied filename — the metadata cards
simply stay empty.

| Variable                | Description                                                                                       | Default |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ------- |
| `TMDB_API_KEY`          | TMDb v3 API key **or** v4 Read-Only Access Token (auto-detected). Used for films + TV.            | unset   |
| `IGDB_ID`               | Twitch Client ID for IGDB (video games). Pair with `IGDB_SECRET`. Both required to enable IGDB.   | unset   |
| `IGDB_SECRET`           | Twitch Client Secret. Used to mint the IGDB app-access token (cached for ~60 days).               | unset   |
| `GOOGLE_BOOKS_API_KEY`  | Optional Google Books fallback for the Open Library source. Open Library itself needs no key.     | unset   |

::: tip Per-source enablement
A missing key returns a clean 503 only for the routes that need that
source — the others keep serving. Disabling all three turns the
"metadata lookup" feature off without affecting uploads.
:::

See the [Metadata providers](../guide/metadata-providers.md) guide
for the operator setup (where to register an API key, what each
provider does, fallback behaviour).

## Notifications

The in-app notification feed (bell + `/notifications`) always works.
External channels (SMTP, Telegram, Discord, ntfy, browser push, …)
are configured per-instance in `/admin/notifications` — they don't
need env vars beyond the encryption secret below.

| Variable                  | Description                                                                                                   | Default |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- | ------- |
| `CHANNEL_ENCRYPTION_KEY`  | AES key used to encrypt notification-channel configs at rest (SMTP password, Telegram token, VAPID private key, …). When unset, falls back to `NUXT_SESSION_SECRET`. Generate with `openssl rand -hex 32`. | falls back to `NUXT_SESSION_SECRET` |

For Web Push specifically: VAPID keys are generated automatically
when the admin saves the channel for the first time — no env var
required. See the [Notifications](../guide/notifications.md) guide.

## Two-factor auth & sessions

| Variable                 | Description                                              | Default |
| ------------------------ | -------------------------------------------------------- | ------- |
| `WEBAUTHN_RP_NAME`       | Relying-party name shown by the browser at registration. | `Trackarr` |
| `WEBAUTHN_RP_ID`         | RP id (the host the passkey is bound to). Inferred from `Origin` when unset; pin explicitly behind a load balancer. | inferred |
| `WEBAUTHN_ORIGIN`        | Origin allow-list for assertions. Inferred when unset.   | inferred |

(2FA is enabled per-user from `/settings#security`. Force-enrolment is configured live via `/admin/settings`, not via env.)

## Example `.env` File

```bash
# Application
NUXT_PUBLIC_SITE_NAME="My Private Tracker"
NUXT_PUBLIC_SITE_URL="https://tracker.example.com"
NUXT_PUBLIC_ANNOUNCE_URL="https://announce.example.com/announce"
NODE_ENV=production

# Database
DATABASE_URL="postgresql://tracker:secretpassword@db:5432/trackarr"
POSTGRES_USER=tracker
POSTGRES_PASSWORD=secretpassword
POSTGRES_DB=trackarr

# Redis
REDIS_URL="redis://:redispassword@redis:6379"
REDIS_PASSWORD=redispassword

# Security
NUXT_SESSION_PASSWORD="your-32-character-session-password-here"
TRACKER_SECRET="your-tracker-secret-for-passkeys"
IP_HASH_SECRET="your-ip-hashing-secret"
POW_DIFFICULTY=5

# Tracker
TRACKER_INTERVAL=1800
TRACKER_MIN_INTERVAL=900
```

::: warning
Never commit `.env` files to version control. Use `.env.example` as a template.
:::
