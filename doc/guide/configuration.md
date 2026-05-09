# Configuration

Trackarr is configured primarily through environment variables. This page covers all available options.

## Environment Variables

### Core Settings

| Variable                | Description                        | Default    |
| ----------------------- | ---------------------------------- | ---------- |
| `NUXT_PUBLIC_SITE_NAME` | Your tracker's display name        | `Trackarr` |
| `NUXT_PUBLIC_SITE_URL`  | Public URL of your tracker         | —          |
| `NUXT_SESSION_PASSWORD` | Session encryption key (32+ chars) | —          |

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
| `TRACKER_SECRET`               | Secret for generating passkeys              | —                                |
| `IP_HASH_SECRET`               | Secret for hashing peer IPs                 | —                                |
| `NUXT_PUBLIC_TRACKER_HTTP_URL` | HTTP announce URL (shown in .torrent files) | `http://localhost:8080/announce` |
| `NUXT_PUBLIC_TRACKER_UDP_URL`  | UDP announce URL                            | `udp://localhost:8081/announce`  |
| `NUXT_PUBLIC_TRACKER_WS_URL`   | WebSocket URL                               | `ws://localhost:8082`            |
| `TRACKER_DEBUG`                | Enable verbose tracker logging              | `false`                          |

::: tip Configuring Tracker URLs
These URLs are embedded in `.torrent` files and displayed in the admin dashboard. They are read at **runtime** by Nuxt — the `NUXT_PUBLIC_` prefix is required so the same Docker image can be reused by anyone with their own domain (no rebuild needed).

```bash
# In your .env file
NUXT_PUBLIC_TRACKER_HTTP_URL=https://tracker.your-domain.com/announce
NUXT_PUBLIC_TRACKER_UDP_URL=udp://tracker.your-domain.com:8081/announce
NUXT_PUBLIC_TRACKER_WS_URL=wss://tracker.your-domain.com/ws
```

Replace `your-domain.com` with your actual tracker domain.
:::

::: warning Breaking change since v0.5.7
Previous versions used unprefixed `TRACKER_HTTP_URL`, `TRACKER_UDP_URL`, `TRACKER_WS_URL`. Those are no longer read — rename them in your `.env` file when upgrading.
:::

### Security

| Variable            | Description                     | Default |
| ------------------- | ------------------------------- | ------- |
| `POW_DIFFICULTY`    | Proof of Work difficulty (1-10) | `5`     |
| `RATE_LIMIT_WINDOW` | Rate limit window in seconds    | `60`    |
| `RATE_LIMIT_MAX`    | Max requests per window         | `100`   |
| `TRUST_PROXY`       | Honour `X-Forwarded-For` for client IP. Set to `true` only when a trusted reverse proxy is in front. | `false` |
| `REDIS_KEY_PREFIX`  | Prefix every Redis key. Must match between the API (ioredis) and the Go tracker. | `ot:` |

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
| `WEBAUTHN_RP_NAME`  | Relying-party name shown by the browser at registration. | `Trackarr`   |
| `WEBAUTHN_RP_ID`    | RP id (host the passkey is bound to). Inferred when unset. | inferred   |
| `WEBAUTHN_ORIGIN`   | Origin allow-list for assertions. Inferred when unset.   | inferred     |

Most 2FA configuration is **runtime** rather than env-driven — the *Force 2FA* enforcement scope (off / staff / all) is set by an admin from `/admin/settings` and stored in the `settings` table. See the [Two-Factor Auth guide](./two-factor-auth.md).

## Docker Compose Configuration

### Production (`docker-compose.prod.yml`)

The production compose file includes:

- **app** — Main Trackarr application (Nuxt + tracker)
- **postgres** — PostgreSQL 16 database
- **pgbouncer** — Connection pooling
- **redis** — Redis 7 cache
- **caddy** — Reverse proxy with automatic HTTPS

### Development (`docker-compose.yml`)

A simplified setup for local development:

```yaml
services:
  app:
    build: .
    ports:
      - '3000:3000'
    environment:
      - DATABASE_URL=postgresql://tracker:tracker@db:5432/trackarr
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=tracker
      - POSTGRES_PASSWORD=tracker
      - POSTGRES_DB=trackarr
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
```

## Caddy Configuration

The production setup uses Caddy for automatic HTTPS. Configuration is in `docker/caddy/Caddyfile`:

```
{$DOMAIN} {
    reverse_proxy trackarr-app:3000
}

{$TRACKER_DOMAIN} {
    reverse_proxy trackarr-app:8080
}
```

## Security Recommendations

For production deployments, ensure:

1. All secrets are at least 32 characters (generate with `openssl rand -hex 32`)
2. `IP_HASH_SECRET` is set — the app refuses to start without it
3. Database and Redis ports are not exposed to the host
4. HTTPS is enforced on all endpoints (Caddy handles this automatically)
5. `TRUST_PROXY=true` is set when behind a reverse proxy you control
