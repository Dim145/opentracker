<div align="center">

# 🌐 Trackarr

**A modern, high-performance private BitTorrent tracker**

Three containers — Nuxt 4 web · Nitro API · Go tracker — backed by PostgreSQL and Redis.

[![Node.js](https://img.shields.io/badge/Node.js-24+-339933?style=flat&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Nuxt](https://img.shields.io/badge/Nuxt-4-00DC82?style=flat&logo=nuxtdotjs&logoColor=white)](https://nuxt.com/)
[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?style=flat&logo=go&logoColor=white)](https://go.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat)](LICENSE)

[Features](#-features) • [Architecture](#-architecture) • [Quick Start](#-quick-start) • [Static deployment](#-static-deployment-no-ssr) • [Security](#-security-architecture) • [Live Demo](https://tracker.florianargaud.com/)

![Trackarr Homepage](apps/web/public/images/image%20copy%203.png)

</div>

---

## ✨ Features

### Privacy & authentication

| Feature                       | Notes                                                                  |
| ----------------------------- | ---------------------------------------------------------------------- |
| Zero-Knowledge auth (ZKE)     | PBKDF2-600k + SHA-256 verifier; password never leaves the browser      |
| Passkey rotation              | One-click rotate from `/me`; sessions stay valid until manual sign-out |
| Self-service password change  | Same ZK flow as login — server only sees a fresh salt + verifier       |
| Privacy toggles               | Hide last-seen on public profile (mods/admins always see the truth)    |
| Proof of Work on registration | Stops drive-by signup spam                                             |
| Hashed IPs                    | SHA-256 with daily-rotating salt — no raw IP persistence               |
| Auto IP banlist               | Banning a user atomically banlists their last-known IP                 |

### Browse & discover

| Feature              | Notes                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Smart media-id paste | Paste an IMDb / TMDb / TVDB URL or bare id into search → filtered listing                          |
| TMDb metadata lookup | Posters, year, ratings, overview pulled from TMDb (operator API key)                               |
| User-facing tags     | Per-torrent tag chips with autocomplete + filter panel                                             |
| Categories           | Hierarchical with Newznab ids — *Arr clients consume the Torznab feed                              |
| Full-text search     | PostgreSQL `gin_trgm_ops` on torrent name                                                          |
| Forum                | Pinned + locked topics, BBCode-friendly editor                                                     |

### Upload workflow

| Feature                     | Notes                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Dedicated upload page       | Replaces the cramped modal — numbered sections, sticky action bar, live preview sidebar              |
| Auto title + tags           | Filename is parsed: clean title, year, S/E, resolution, source, codec, audio, lang flags             |
| TMDb search picker          | Auto-searches the parsed title (debounced, ↑↓+Enter); results pre-fill IMDb / TMDb / TVDB ids        |
| Conditional ID block        | IDs section only renders for movie/tv categories — hidden for audio, books, etc.                     |
| WYSIWYG description         | Tiptap-based editor; pasted BBCode/HTML/Markdown converts cleanly                                    |
| NFO support                 | Drag-drop or paste; CP437 → UTF-8 fallback for ASCII-art                                             |
| Required description        | Soft-enforced client-side — red asterisk, status-bar gate, disabled submit until non-empty          |
| Editable release name       | Override the parsed `.torrent` name without rotating the file                                        |

### Operator console

| Surface              | Notes                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `/admin/users`       | Paginated registry: KPI strip, role / activity / status filters, sortable columns, inline ban/role   |
| `/admin/...`         | Categories, roles, invites, branding, panic, tags, Torznab settings, reports, HnR                    |
| Prometheus metrics   | Dedicated port; tracker swarm + API request stats                                                    |
| Settings (per-user)  | Display name, bio, last-seen privacy toggle, theme, change password, sign-out                        |

### Personal pages

| Page          | Notes                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `/me`         | Hero with KPI strip (Uploaded / Ratio / Downloaded / Released), tracker credentials, activity tabs   |
| `/me` tabs    | "My uploads" + "My seeds" (Active / Pending / Met / HnR), each with live swarm enrichment            |
| `/users/[id]` | Public profile — uses display name, bio, redacts last-seen when the user opted out                   |
| `/settings`   | Editorial layout with anchor sidebar, sticky save bar, theme picker, change-password ZK flow         |

### Performance & resilience

| Feature                     | Notes                                                                       |
| --------------------------- | --------------------------------------------------------------------------- |
| Distributed rate limiting   | Redis-backed sliding windows; progressive penalties; auto IP bans           |
| **Panic Mode**              | Instant AES-256-GCM encryption of torrent data + user fields                |
| Memory-tuned containers     | V8 heap caps + glibc arena caps halve runtime RAM                           |
| Optional static deployment  | Distroless nginx serves a CSR bundle in **~28 MB** — see below              |

---

## 🏗️ Architecture

Trackarr ships as **three independent containers** behind Caddy, plus the usual Postgres + Redis pair. They share zero process state — Redis is the only cross-cutting bus.

```
                              ┌───────────────────────────────────┐
   Browser ──HTTPS──►   Caddy │ /announce  → tracker (Go)         │
                              │ /api/*     → api (Nitro)          │
                              │ /uploads/* → api (Nitro)          │
                              │ /*         → web (Nuxt SSR)       │
                              └───────────────────────────────────┘
                                  │            │           │
                                  ▼            ▼           ▼
                       ┌─────────────┐ ┌─────────────┐ ┌──────────┐
                       │  apps/web   │ │  apps/api   │ │ apps/    │
                       │  Nuxt 4 SSR │ │ Nitro 4     │ │ tracker  │
                       │  Vue 3      │ │ Drizzle ORM │ │ Go 1.25  │
                       │  TypeScript │ │ Zod, h3     │ │ sqlc     │
                       └─────────────┘ └──────┬──────┘ └────┬─────┘
                                              │             │
                                              ▼             ▼
                                       ┌─────────────────────────┐
                                       │   PgBouncer (pool)      │
                                       └────────────┬────────────┘
                                                    │
                                              ┌─────▼─────┐
                                              │ Postgres  │
                                              └───────────┘
                                              ┌───────────┐
                                              │   Redis   │ ◄── tracker peers,
                                              └───────────┘     sessions, rate limit
```

**Why three containers**

- **The tracker is its own thing.** It's the hot path — every BitTorrent client in the swarm hits `/announce` every few minutes. Rewriting it from Node.js to a static Go binary on `scratch` (~10 MB image, sub-ms p99) means a single broken Nuxt deploy can't take down announces, and the announce path doesn't pay V8 startup costs. The Go module uses `sqlc` for type-safe DB access; the announce protocol talks to the same Redis hashes Node used to write, so callers don't change.
- **The API and the web are split.** `apps/api` is Nitro standalone — every `/api/*` route, the upload endpoints, the metadata lookups, the admin tools. `apps/web` is Nuxt SSR — the rendered shell + page chunks. The split lets each scale and redeploy independently, and the static-build alternative below replaces only `apps/web`.
- **Distroless everywhere.** `apps/web` and `apps/api` run on `gcr.io/distroless/nodejs24-debian13:nonroot`. The tracker runs on `scratch`. The optional static frontend runs on `cgr.dev/chainguard/nginx`. No shells, no package managers, signed images, non-root by default.

---

## 🔐 Security architecture

### Zero-Knowledge authentication

Trackarr's auth is **zero-knowledge**: the server never sees or stores your password. All cryptographic operations happen in the browser.

```
┌─────────────────────────────────────────────────────────────────────┐
│                        REGISTRATION FLOW                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐                              ┌─────────────────┐  │
│  │   CLIENT    │                              │     SERVER      │  │
│  └──────┬──────┘                              └────────┬────────┘  │
│         │                                              │           │
│         │ 1. Solve PoW Challenge (anti-spam)           │           │
│         │ ◄────────────────────────────────────────────┤           │
│         │                                              │           │
│         │ 2. Generate random salt (32 bytes)           │           │
│         │ 3. Derive key = PBKDF2(password, salt)       │           │
│         │ 4. Compute verifier = SHA256(key)            │           │
│         │                                              │           │
│         │ 5. Send {username, salt, verifier} ─────────►│           │
│         │    Password NEVER leaves client              │           │
│         │                                              │           │
│         │                              6. Store salt + │           │
│         │                                 verifier     │           │
│         │                              7. Create session           │
│         │ ◄──────────────────────────────── 8. OK ─────┤           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                          LOGIN FLOW                                 │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐                              ┌─────────────────┐  │
│  │   CLIENT    │                              │     SERVER      │  │
│  └──────┬──────┘                              └────────┬────────┘  │
│         │                                              │           │
│         │ 1. Request challenge ───────────────────────►│           │
│         │                                              │           │
│         │ ◄──────── 2. Return {salt, challenge} ───────┤           │
│         │                                              │           │
│         │ 3. Derive key = PBKDF2(password, salt)       │           │
│         │ 4. Compute verifier = SHA256(key)            │           │
│         │ 5. Generate proof = SHA256(verifier+challenge)           │
│         │                                              │           │
│         │ 6. Send {username, proof, challenge} ───────►│           │
│         │    Password NEVER leaves client              │           │
│         │                                              │           │
│         │                       7. Compute expected =  │           │
│         │                          SHA256(storedVerifier+challenge)│
│         │                       8. Verify proof == expected        │
│         │ ◄──────────────────────────────── 9. Session ┤           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

The same primitives drive **password change** in `/settings` — the client requests a fresh challenge, proves knowledge of the *current* password, then ships a new salt + verifier derived from the new one. The server validates the proof and rotates atomically.

**Key properties**

- Password never transmitted — only cryptographic proofs
- PBKDF2 with **600k** iterations (OWASP 2023) — brute-force resistant
- Unique challenge per login, single-use, 5-minute Redis TTL — prevents replay
- Proof of Work on registration — stops automated signup attacks
- Constant-time proof comparison server-side

---

### 🚨 Panic Mode

The Panic Button lets administrators **instantly encrypt all sensitive data**. Once activated, .torrent files are unusable and user data is unreadable.

```
┌───────────────────────────────────────────────────────────────────┐
│                       NORMAL STATE                                │
│  • Torrents downloadable                                          │
│  • User data readable                                             │
│  • Posts & comments visible                                       │
└───────────────────────────────────────────────────────────────────┘
                              │
                    PANIC ACTIVATED
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                      ENCRYPTED STATE                              │
│  • .torrent files → AES-256-GCM encrypted (unusable)              │
│  • Torrent names  → [ENCRYPTED]                                   │
│  • Torrent sizes  → 0                                             │
│  • User credentials → Encrypted                                   │
│  • Forum posts    → Encrypted                                     │
└───────────────────────────────────────────────────────────────────┘
                              │
                    RESTORE (with password)
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                       RESTORED STATE                              │
│  All data restored to original state                              │
└───────────────────────────────────────────────────────────────────┘
```

| Step | Detail                                                                |
| ---- | --------------------------------------------------------------------- |
| 1    | First admin sets a Panic Password during registration (12+ chars)     |
| 2    | Panic password is hashed and stored — never plaintext                 |
| 3    | Activate: Admin → Settings → Panic → type `ENCRYPT_ALL_DATA`          |
| 4    | Restore: enter the original Panic Password                            |

| Component       | Algorithm                       |
| --------------- | ------------------------------- |
| Key Derivation  | scrypt (32 bytes)               |
| Encryption      | AES-256-GCM                     |
| IV              | 16 bytes random (per session)   |

> ⚠️ Without the Panic Password, encrypted data is **permanently lost**. There is no recovery mechanism.

See the full guide: [doc/guide/panic-mode.md](doc/guide/panic-mode.md)

---

## 🚀 Quick Start

### Prerequisites

- **Docker** 20+ and **Docker Compose v2**

### Local development (one command)

```bash
git clone https://github.com/florianjs/trackarr.git && cd trackarr
cp .env.example .env
docker compose up -d
```

Open **[http://localhost:3000](http://localhost:3000)** — the first user to register becomes the admin.

### Production deployment

For a real VPS deployment with HTTPS via Caddy, follow the **[Docker deployment guide](doc/guide/getting-started.md)**. It covers:

- DNS records you need to set up
- Generating secrets with `openssl`
- The interactive `scripts/setup.sh` helper for production
- Starting and updating the stack
- Backups and operational commands

![Torrent List](apps/web/public/images/image.png)
![Torrent Details](apps/web/public/images/image%20copy%202.png)

---

## 🪶 Static deployment (no SSR)

For deployments where SSR overhead isn't worth it, a second image — built from `apps/web/Dockerfile.static` — serves a fully static SPA from **distroless Chainguard nginx** (~28 MB image, ~7 MB resident memory).

| | SSR (default) | **Static** |
| --- | ---: | ---: |
| Image size  | 254 MB | **28 MB** |
| Idle RSS    | ~120 MB | **~7 MB** |
| Cold start  | ~2 s | **<100 ms** |
| Base image  | `distroless/nodejs24` | **`chainguard/nginx`** |
| First paint | server-rendered HTML | SPA shell, hydrates client-side |

```bash
docker compose \
  -f docker-compose.prod.yml \
  -f docker-compose.static.yml \
  --env-file .env \
  up -d --build
```

**Runtime URLs**: the static bundle has no env-var injection. On boot the SPA fetches `GET /api/runtime-config` and patches `useRuntimeConfig().public` from the response, so the same image is portable across domains — only the API container needs the `NUXT_PUBLIC_TRACKER_*_URL` vars set. See [`apps/web/app/plugins/runtime-config.client.ts`](apps/web/app/plugins/runtime-config.client.ts).

The static container listens on `:3000` to match the existing Caddy upstream — no Caddyfile change needed when switching between the two images.

---

## 🔒 Security

> **For production, always generate strong secrets** (see the [deployment guide](doc/guide/getting-started.md)) and put the app behind a reverse proxy. Caddy is included.

### Defense in depth

| Layer              | Protection                                                  |
| ------------------ | ----------------------------------------------------------- |
| **Authentication** | ZKE, PoW anti-abuse, sealed-cookie sessions, CSRF protection |
| **Database**       | SCRAM-SHA-256 auth, TLS, prepared statements, pool limits   |
| **Redis**          | Password auth, command restrictions, memory limits          |
| **Network**        | Rate limiting, auto IP bans, attack pattern detection       |
| **Privacy**        | SHA-256 hashed IPs, no raw IP persistence, minimal logging  |
| **Container**      | Distroless bases, non-root users, dropped capabilities      |

### Rate limits

| Endpoint   | Limit   | Ban on abuse                    |
| ---------- | ------- | ------------------------------- |
| Public API | 100/min | 100+ req/10s → auto-block       |
| Mutations  | 10/min  | Progressive penalties           |
| Auth       | 5/5min  | IP blacklisted after violations |
| Tracker    | 200/min | Distributed sliding window      |

### Production checklist

- [ ] Generate cryptographic secrets (32+ chars) — `NUXT_SESSION_SECRET`, `IP_HASH_SECRET`, `ADMIN_API_KEY`
- [ ] Set strong passwords for `DB_PASSWORD` and `REDIS_PASSWORD`
- [ ] Configure TLS — Caddy handles Let's Encrypt automatically
- [ ] Restrict firewall to ports 80/443 only
- [ ] Set `TRUST_PROXY=true` (already on in `docker-compose.prod.yml`)
- [ ] Set up automated PostgreSQL backups (see [doc/guide/backup-restore.md](doc/guide/backup-restore.md))

---

## 🏗️ Tech stack

| Layer            | Technology                                | Notes                                          |
| ---------------- | ----------------------------------------- | ---------------------------------------------- |
| Frontend         | Nuxt 4, Vue 3, Tailwind CSS, Tiptap        | SSR by default, opt-in static SPA build        |
| API              | Nitro 4 (Node 24), Drizzle ORM, Zod       | Standalone container, distroless runtime       |
| Tracker          | Go 1.25, sqlc                             | `scratch`-based image, sub-ms announce p99     |
| Database         | PostgreSQL 16                             | `gin_trgm_ops` full-text, drizzle-kit migrations |
| Connection pool  | PgBouncer                                 | Transaction-mode pooling                       |
| Cache / queue    | Redis 7                                   | Peer hashes, sessions, rate-limit windows      |
| Reverse proxy    | Caddy 2                                   | Auto-HTTPS, HTTP/3                             |
| Crypto           | Web Crypto API, scrypt, AES-256-GCM       | ZKE auth, Panic encryption                     |
| Observability    | Prometheus `/metrics`                     | Dedicated port on the API container            |
| Monorepo         | pnpm workspaces                           | `packages/{shared,db}` + `apps/{web,api,tracker}` |

---

## 🐳 Docker commands

The repo ships three compose files:

| File                          | Purpose                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `docker-compose.yml`          | Local development — mounts source, hot-reload                  |
| `docker-compose.prod.yml`     | Production — Caddy, distroless images, hardened defaults       |
| `docker-compose.static.yml`   | Overlay — swaps the SSR `web` for the static SPA + nginx       |
| `docker-compose.local.yml`    | Local prod-like — same images as prod, no TLS                  |

```bash
docker compose up -d                                   # Local dev
docker compose -f docker-compose.prod.yml up -d        # Production SSR
docker compose -f docker-compose.prod.yml \
               -f docker-compose.static.yml up -d      # Production static
docker compose down                                    # Stop services
docker compose logs -f                                 # View logs
docker compose down -v                                 # Stop + remove volumes
```

### Health probes

```bash
docker exec trackarr-db pg_isready                     # PostgreSQL
docker exec trackarr-redis redis-cli ping              # Redis
curl -fk https://localhost/api/health                  # API
```

### Updating

```bash
git pull origin main
docker compose -f docker-compose.prod.yml up -d --build
```

> Data persists in Docker volumes (`postgres_data`, `redis_data`, `uploads_data`, `caddy_data`) and survives rebuilds.

### Troubleshooting

```bash
# Full restart (no rebuild)
docker compose -f docker-compose.prod.yml restart

# Rebuild after pulling new code
docker compose -f docker-compose.prod.yml up -d --build --force-recreate

# Tail per-service logs
docker compose -f docker-compose.prod.yml logs -f web
docker compose -f docker-compose.prod.yml logs -f api
docker compose -f docker-compose.prod.yml logs -f tracker
```

More: [doc/guide/troubleshooting.md](doc/guide/troubleshooting.md)

---

## 🧪 Development

The repo is a **pnpm monorepo**. Each app builds independently.

```bash
pnpm install                                # Install all workspace deps
pnpm -r --parallel run dev                  # Web + API in parallel (HMR)
pnpm --filter @trackarr/web run dev         # Just the web
pnpm --filter @trackarr/api run dev         # Just the API

pnpm -r run build                           # Build everything
pnpm db:push                                # drizzle-kit push (dev DB)
pnpm db:studio                              # Database GUI
```

The Go tracker:

```bash
cd apps/tracker
go run ./cmd/tracker                        # Run locally
go test ./...                                # Tests
```

![Forum](apps/web/public/images/image%20copy%203.png)

![User profile](apps/web/public/images/image%20copy%204.png)

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing`)
5. Open a Pull Request

---

## 🙏 Acknowledgements

Trackarr is built on the shoulders of giants. Thanks to the following open-source projects:

| Project                                                                | Role                        |
| ---------------------------------------------------------------------- | --------------------------- |
| [Nuxt](https://nuxt.com)                                               | Fullstack Vue framework     |
| [Vue.js](https://vuejs.org)                                            | Reactive frontend framework |
| [Nitro](https://nitro.build)                                           | Universal JS server engine  |
| [Drizzle ORM](https://orm.drizzle.team)                                | TypeScript ORM              |
| [sqlc](https://sqlc.dev)                                               | Go DB codegen for the tracker |
| [PostgreSQL](https://www.postgresql.org)                               | Database                    |
| [Redis](https://redis.io)                                              | In-memory cache             |
| [ioredis](https://github.com/redis/ioredis)                            | Redis client for Node.js    |
| [Caddy](https://caddyserver.com)                                       | Reverse proxy + HTTPS       |
| [Chainguard](https://www.chainguard.dev)                               | Distroless container images |
| [Tailwind CSS](https://tailwindcss.com)                                | Utility-first CSS           |
| [Tiptap](https://tiptap.dev)                                           | WYSIWYG editor              |
| [Chart.js](https://www.chartjs.org)                                    | Charts & visualizations     |
| [Iconify](https://iconify.design)                                      | Icon framework (Phosphor set) |
| [VitePress](https://vitepress.dev)                                     | Documentation framework     |
| [Vitest](https://vitest.dev)                                           | Testing framework           |
| [Pinia](https://pinia.vuejs.org)                                       | State management            |
| [Zod](https://zod.dev)                                                 | Schema validation           |
| [TMDb](https://www.themoviedb.org)                                     | Media metadata source       |

---

<!-- CONTRIBUTORS:START -->

## 👥 Contributors

Thanks to all our contributors! Sorted by number of commits.

|                                                      Avatar                                                       | Contributor                             | Commits |
| :---------------------------------------------------------------------------------------------------------------: | --------------------------------------- | :-----: |
| <img src="https://avatars.githubusercontent.com/u/50747004?v=4" width="40" height="40" style="border-radius:50%"> | **[Dim145](https://github.com/Dim145)** |    4    |
| <img src="https://avatars.githubusercontent.com/u/64362443?v=4" width="40" height="40" style="border-radius:50%"> | **[IkiaeM](https://github.com/IkiaeM)** |    4    |

<!-- CONTRIBUTORS:END -->

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

<div align="center">

**Built with ❤️ for the P2P community**

[Back to top](#-trackarr)

</div>
