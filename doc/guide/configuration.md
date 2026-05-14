# Configuration

Trackarr separates configuration into three layers:

1. **Environment variables** — what each container reads at boot (DSNs, secrets, ports, feature flags). The canonical list lives in the [Environment variables reference](../reference/env.md).
2. **Runtime settings** — site title, tagline, force-2FA scope, upload constraints, branding assets. Operators edit these from `/admin/*` pages; they are persisted in the `settings` table and served live to every container.
3. **Compose / Caddy** — what `docker-compose.prod.yml` and `docker/caddy/Caddyfile` build on top: image tags, port mappings, vhost routing, TLS certs.

This page describes the *layering* and the production layout. For every individual env var, jump to the [reference](../reference/env.md).

## What goes where

| Concern                            | Layer                | Where it lives                                            |
| ---------------------------------- | -------------------- | --------------------------------------------------------- |
| Database / Redis DSN, secrets      | Env                  | `.env` → loaded by `docker-compose.prod.yml`              |
| Announce URL, UDP toggle           | Env (runtime)        | `NUXT_PUBLIC_TRACKER_*`, `TRACKER_UDP_ENABLED`            |
| Metadata API keys (TMDb/IGDB/…)    | Env                  | `TMDB_API_KEY`, `IGDB_ID`, …                              |
| **Site title, tagline, logo, favicon** | Runtime          | `/admin/branding` + `/admin/settings`                     |
| **Upload rules** (NFO, regex, …)   | Runtime              | `/admin/upload-rules`                                     |
| **Force-2FA scope**                | Runtime              | `/admin/settings`                                         |
| **Bonus rules + tiers**            | Runtime              | `/admin/bonus-rules`                                      |
| **Bonus events** (freeleech, …)    | Runtime              | `/admin/bonus-events`                                     |
| **Notification channels** (SMTP, Telegram, …) | Runtime   | `/admin/notifications`                                    |
| **Roles + auto-assignment**        | Runtime              | `/admin/roles`                                            |
| TLS, domain, ACME email            | Compose / Caddy      | `DOMAIN`, `TRACKER_DOMAIN`, `ACME_EMAIL` + Caddyfile      |

::: tip Why not env-everything?
Anything an admin would reasonably tune without a redeploy lives in the
database. The env layer is for things that must be set before the
process boots (secrets, DSNs, ports) or that are intrinsically
build-time (static-SPA URLs).
:::

## Docker compose layout

The production stack ships **three independent application containers** behind Caddy, plus the standard data layer:

| Container      | Role                                                                              |
| -------------- | --------------------------------------------------------------------------------- |
| `web` (`front-ssr`) | Nuxt 4 SSR — UI shell + page chunks                                          |
| `api`          | Nitro 4 standalone — every `/api/*`, `/uploads/*`, SSE notifications              |
| `tracker`      | Go 1.25 — BEP 3 HTTP announce on `:8080`, BEP 15 UDP announce on `:6969`          |
| `postgres`     | PostgreSQL 16                                                                     |
| `pgbouncer`    | Transaction-mode pool between `api`/`tracker` and `postgres`                      |
| `redis`        | Redis 7 — peer hashes, sessions, rate-limit windows, pub/sub bus                  |
| `caddy`        | Reverse proxy + automatic Let's Encrypt HTTPS                                     |

```bash
docker compose -f docker-compose.prod.yml up -d
```

### Static-SPA overlay

When you don't need SSR, swap the `web` container for a distroless
nginx serving the static SPA bundle (~28 MB image, ~7 MB resident
memory):

```bash
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.static.yml \
  --env-file .env \
  up -d
```

See [Local Production — Static SPA variant](./local-production.md#static-spa-variant).

## Caddy routing

`docker/caddy/Caddyfile` splits traffic by path on the main domain and uses a dedicated subdomain for the tracker:

```caddyfile
{$DOMAIN} {
    handle /announce*  { reverse_proxy tracker:8080 }
    handle /api/*      { reverse_proxy api:4000 }
    handle /uploads/*  { reverse_proxy api:4000 }
    handle             { reverse_proxy web:3000 }
}

{$TRACKER_DOMAIN} {
    reverse_proxy tracker:8080
}
```

UDP announces bypass Caddy entirely — Caddy doesn't reverse-proxy UDP, and BEP 15 needs no TLS termination. The `tracker` container binds `6969/udp` directly on the host (see `docker-compose.prod.yml`).

Caddy is also configured to **scrub the `passkey` query parameter** from access logs before they hit disk — the tracker needs the passkey in the URL by BitTorrent protocol, but it must never end up persisted in a log file.

## Build-time vs runtime config in `apps/web`

The static-SPA build patches `useRuntimeConfig().public` from `/api/runtime-config` on first paint. That endpoint reads the live tracker URLs from the `api` container's environment (`NUXT_PUBLIC_TRACKER_*`), which means a single image is portable across domains — only the `api` container needs the announce URLs.

## Tuning that *isn't* env-driven

A few constants are hand-tuned in source and need a rebuild:

- **Announce interval / min interval / peer cap** — `apps/tracker/internal/server/response.go`.
- **PoW difficulty + rate-limit windows** — `apps/api/utils/{pow,rateLimit}.ts`.

If you change them, rebuild the affected container (`api` or `tracker`) and redeploy.

## Production checklist

Before going live, verify:

1. Every secret is 32+ chars (`openssl rand -hex 32`).
2. `IP_HASH_SECRET`, `NUXT_SESSION_SECRET`, `ADMIN_API_KEY` are all set — the app refuses to start without them.
3. `DOMAIN` + `TRACKER_DOMAIN` resolve to the VPS, port 80/443 inbound is open.
4. `TRUST_PROXY=true` (already on in `docker-compose.prod.yml`) so the rate limiter sees the real client IP through Caddy.
5. Postgres and Redis ports are **not** exposed on the host (compose `expose:` not `ports:`).
6. A backup cron is in place — see [Backup & Restore](./backup-restore.md).
7. If you enabled `METRICS_ENABLED`, firewall the metrics port (default `:9090`) separately from `:80/:443`.

For per-feature setup, jump to the right guide from the sidebar: [Notifications](./notifications.md), [Metadata Providers](./metadata-providers.md), [UDP Tracker](./udp-tracker.md), [Two-Factor Auth](./two-factor-auth.md), [Panic Mode](./panic-mode.md), and so on.
