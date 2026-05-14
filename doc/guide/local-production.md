# Local Production Testing

The same `docker-compose.prod.yml` that runs your real deployment can
also be used to exercise the full container stack on your laptop —
useful when you're verifying a migration, debugging a release
candidate, or rehearsing an upgrade against a freshly seeded
database.

## Prerequisites

- **Docker** (or **OrbStack** on macOS — recommended for the
  `.orb.local` hostname routing).
- A populated `.env` file in the repo root. See
  [Getting Started](./getting-started.md#production-deployment) for
  the full env recipe. The minimal set is:
  ```bash
  NUXT_SESSION_SECRET=$(openssl rand -hex 32)
  ADMIN_API_KEY=$(openssl rand -hex 32)
  IP_HASH_SECRET=$(openssl rand -hex 32)
  CHANNEL_ENCRYPTION_KEY=$(openssl rand -hex 32)
  DB_PASSWORD=$(openssl rand -hex 16)
  REDIS_PASSWORD=$(openssl rand -hex 16)
  ```

## Bring the stack up

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

This builds the three application containers (`web`, `api`,
`tracker`) plus the data layer (`postgres`, `pgbouncer`, `redis`)
and `caddy`. The whole stack is reachable through Caddy on `:80` /
`:443`. The first boot:

1. waits for Postgres + Redis health checks,
2. lets the API container run `drizzle-kit push --force` against
   `packages/db/src/schema.ts` to land any schema delta,
3. boots the web frontend.

### Without TLS termination

If you don't want Caddy issuing certs against `localhost`, point
your `DOMAIN` at a local-only hostname (OrbStack: `trackarr.orb.local`)
or override the Caddyfile to disable HTTPS for development.

## Common commands

```bash
# Tail every service
docker compose -f docker-compose.prod.yml logs -f

# Tail one of the three apps
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f web
docker compose -f docker-compose.prod.yml logs -f tracker

# Connect to the DB
docker compose -f docker-compose.prod.yml exec postgres \
  psql -U "$DB_USER" -d "$DB_NAME"

# Take everything down (keeps volumes)
docker compose -f docker-compose.prod.yml down

# Wipe everything (DB + Redis + uploads)
docker compose -f docker-compose.prod.yml down -v
```

## Static SPA variant

`docker-compose.static.yml` is an overlay that swaps the SSR Nuxt
container for a distroless nginx serving a pre-built SPA bundle
(`apps/web/Dockerfile.static`). The rest of the stack — API,
tracker, Caddy, Postgres, Redis, PgBouncer — is inherited from the
prod compose unchanged.

```bash
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.static.yml \
  --env-file .env \
  up -d --build
```

Why bother:

- **Runtime memory** drops from ~120-150 MB sustained (SSR) to
  ~10-15 MB (nginx idle).
- **Cold-start** drops from ~2 s booting Nitro to ~0.1 s.
- **Image size** drops from ~80 MB (Node + bundle) to ~30 MB
  (nginx + assets).

Trade-offs:

- No SSR means no SEO out of the box (every page hydrates client-
  side). For a private tracker this is usually fine — nothing is
  indexed publicly anyway.
- First Contentful Paint is slower for the first uncached visit
  (the SPA shell must download + execute before anything renders).
  Subsequent navigations are much faster.

The static bundle reads the runtime tracker URLs from
`/api/runtime-config` on boot, so the same image is portable
across domains.

## Troubleshooting

### "Port already allocated"

Stop whatever else is binding `:80` / `:443` / `:8080` / `:6969`
before bringing the stack up — typically a host nginx, another
docker compose, or the dev server on `pnpm dev`.

### Database connection errors

Check the `.env` values match. Both the `api` and `postgres`
containers read `${DB_USER}`, `${DB_PASSWORD}`, `${DB_NAME}` from
the same file; a typo there shows up as `password authentication
failed for user "tracker"` in the API logs.

### Drizzle push hangs at boot

The API container runs `drizzle-kit push --force` against
`schema.ts` on first start. If you suspect a runaway migration:

```bash
docker compose -f docker-compose.prod.yml logs api | grep drizzle
```

A clean push exits within a few seconds; anything longer means
Postgres is unresponsive (check `docker compose logs postgres`).
