# Configuration

Trackarr is configured primarily through environment variables. This page covers all available options.

## Environment Variables

### Core Settings

| Variable                | Description                                                                | Default    |
| ----------------------- | -------------------------------------------------------------------------- | ---------- |
| `NUXT_PUBLIC_SITE_NAME` | Your tracker's display name                                                | `Trackarr` |
| `NUXT_PUBLIC_SITE_URL`  | Public URL of your tracker                                                 | —          |
| `NUXT_SESSION_SECRET`   | Session encryption key (32+ chars). Generate with `openssl rand -hex 32`.  | —          |
| `TRACKARR_NAME`         | Display name used as the WebAuthn relying-party name and the TOTP issuer.  | `Trackarr` |

### Database

| Variable            | Description                  | Default    |
| ------------------- | ---------------------------- | ---------- |
| `DATABASE_URL`      | PostgreSQL connection string | —          |
| `POSTGRES_USER`     | Database username            | `tracker`  |
| `POSTGRES_PASSWORD` | Database password            | —          |
| `POSTGRES_DB`       | Database name                | `trackarr` |

### Redis

| Variable         | Description             | Default                  |
| ---------------- | ----------------------- | ------------------------ |
| `REDIS_URL`      | Redis connection string | `redis://localhost:6379` |
| `REDIS_PASSWORD` | Redis password          | —                        |

### Tracker

| Variable                       | Description                                 | Default                          |
| ------------------------------ | ------------------------------------------- | -------------------------------- |
| `IP_HASH_SECRET`               | Secret for hashing peer IPs                 | —                                |
| `NUXT_PUBLIC_TRACKER_HTTP_URL` | HTTP announce URL (shown in .torrent files) | `http://localhost:8080/announce` |
| `NUXT_PUBLIC_TRACKER_UDP_URL`  | UDP announce URL                            | `udp://localhost:6969/announce`  |
| `TRACKER_DEBUG`                | Enable verbose tracker logging              | `false`                          |

::: tip Tracker tunables aren't env-driven
Announce interval, min interval and the per-response peer cap are
hard-coded in `apps/tracker/internal/server/response.go`. They
aren't read from the environment today — rebuild the tracker
binary if you need to change them.
:::

::: warning WebSocket announces are not implemented
A WebSocket / WebTorrent announce path is on the roadmap but not
in the build yet. Don't advertise a `wss://` URL in your `.torrent`
files — clients will hang trying to connect.
:::

::: tip Configuring Tracker URLs
These URLs are embedded in `.torrent` files and displayed in the admin dashboard. They are read at **runtime** by Nuxt — the `NUXT_PUBLIC_` prefix is required so the same Docker image can be reused by anyone with their own domain (no rebuild needed).

```bash
# In your .env file
NUXT_PUBLIC_TRACKER_HTTP_URL=https://tracker.your-domain.com/announce
NUXT_PUBLIC_TRACKER_UDP_URL=udp://tracker.your-domain.com:6969/announce
```

Replace `your-domain.com` with your actual tracker domain. UDP is
served on port `6969` (BEP 15 convention).
:::

::: warning Breaking change since v0.5.7
Previous versions used unprefixed `TRACKER_HTTP_URL`, `TRACKER_UDP_URL`, `TRACKER_WS_URL`. Those are no longer read — rename them in your `.env` file when upgrading.
:::

### Security

| Variable            | Description                                                                                              | Default |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ------- |
| `TRUST_PROXY`       | Honour `X-Forwarded-For` for client IP. Set to `true` only when a trusted reverse proxy is in front. The rightmost token (the one the proxy appended) is used. | `false` |
| `REDIS_KEY_PREFIX`  | Prefix every Redis key. Must match between the API (ioredis) and the Go tracker.                          | `ot:`   |

::: tip Hand-tuned security defaults
PoW difficulty, rate-limit window and rate-limit max are not env-
driven today — they live as constants in
`apps/api/utils/{pow,rateLimit}.ts`. Adjust those files and
rebuild if you need to retune them.
:::

### Observability

The Prometheus scrape endpoint is opt-in and listens on its own port —
firewall it independently of the public API.

| Variable            | Description                                                              | Default     |
| ------------------- | ------------------------------------------------------------------------ | ----------- |
| `METRICS_ENABLED`   | Master switch (`true`/`1`/`on`/`yes`).                                   | `false`     |
| `METRICS_HOST`      | Bind address.                                                            | `0.0.0.0`   |
| `METRICS_PORT`      | Bind port.                                                               | `9090`      |
| `METRICS_PATH`      | Scrape path.                                                             | `/metrics`  |
| `METRICS_AUTH_TOKEN`| Optional `Authorization: Bearer <token>` requirement on the endpoint.    | unset       |

See the dedicated [Prometheus Metrics reference](../reference/metrics.md) for the full list.

### Two-factor / WebAuthn

| Variable            | Description                                              | Default      |
| ------------------- | -------------------------------------------------------- | ------------ |
| `TRACKARR_NAME`     | Public name shown by the browser at WebAuthn registration AND by authenticator apps as the TOTP issuer label. | `Trackarr` |
| `WEBAUTHN_RP_ID`    | RP id (host the passkey is bound to). Inferred when unset. | inferred   |
| `WEBAUTHN_ORIGIN`   | Origin allow-list for assertions. Inferred when unset.   | inferred     |

Most 2FA configuration is **runtime** rather than env-driven — the *Force 2FA* enforcement scope (off / staff / all) is set by an admin from `/admin/settings` and stored in the `settings` table. See the [Two-Factor Auth guide](./two-factor-auth.md).

## Docker Compose Configuration

### Production (`docker-compose.prod.yml`)

The production compose file ships **three independent application
containers** behind Caddy, plus the standard data layer:

- **web** — Nuxt 4 web app (SSR / static SPA)
- **api** — Nitro API (REST + SSE notifications)
- **tracker** — Go BitTorrent tracker (HTTP + UDP announces)
- **postgres** — PostgreSQL 16 database
- **pgbouncer** — Connection pooling between the API and Postgres
- **redis** — Redis 7 cache (peer store, sessions, rate limiting, pub/sub)
- **caddy** — Reverse proxy with automatic HTTPS

### Development (`docker-compose.yml`)

The repo's `docker-compose.yml` only brings up the **data layer**
(Postgres + Redis); the app processes run on the host via
`pnpm dev`. This keeps the local feedback loop tight without
rebuilding container images on every change.

```yaml
# Bring up Postgres + Redis only — the app processes run on the host.
services:
  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=tracker
      - POSTGRES_PASSWORD=tracker
      - POSTGRES_DB=trackarr
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: ['redis-server', '--requirepass', 'devpassword']
    volumes:
      - redis_data:/data
```

Then in another terminal:

```bash
docker compose up -d        # postgres + redis
pnpm install
pnpm dev                    # starts api + web + tracker on the host
```

## Caddy Configuration

The production setup uses Caddy for automatic HTTPS. The bundled
config (`docker/caddy/Caddyfile`) splits traffic across the three
app containers by path:

```
{$DOMAIN} {
    handle_path /api/* {
        reverse_proxy api:4000
    }
    handle_path /uploads/* {
        reverse_proxy api:4000
    }
    handle / {
        reverse_proxy web:3000
    }
}

{$TRACKER_DOMAIN} {
    reverse_proxy tracker:8080
}
```

UDP announces bypass Caddy entirely — Caddy can't reverse-proxy UDP
and BEP 15 doesn't need TLS termination. Expose `6969/udp` from the
`tracker` container directly.

## Security Recommendations

For production deployments, ensure:

1. All secrets are at least 32 characters (generate with `openssl rand -hex 32`)
2. `IP_HASH_SECRET` is set — the app refuses to start without it
3. Database and Redis ports are not exposed to the host
4. HTTPS is enforced on all endpoints (Caddy handles this automatically)
5. `TRUST_PROXY=true` is set when behind a reverse proxy you control
