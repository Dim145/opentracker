---
layout: home

hero:
  name: Trackarr
  text: Modern Private BitTorrent Tracker
  tagline: High-performance, security-first tracker with Zero-Knowledge Authentication, Two-Factor Auth, and Panic Mode encryption.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/Dim145/opentracker

features:
  - title: Zero-Knowledge Auth
    details: Your password never leaves your device. SRP-style challenge/response with PBKDF2 client-side; the server only ever sees a verifier.
  - title: Two-Factor Auth
    details: TOTP with recovery codes plus WebAuthn passkeys. Trusted-device cookies skip 2FA on familiar browsers; admins can force enrolment for staff or everyone.
  - title: Lightning Fast
    details: Redis-powered sub-millisecond peer lookups, Postgres trigram search, and a Go announce hot path designed for thousands of swarms per second.
  - title: Panic Mode
    details: One-click AES-256-GCM encryption of every sensitive column. The data is recoverable only with your panic password — no server-side key escrow.
  - title: Moderation pipeline
    details: Pending / accepted / changes-requested / rejected lifecycle with a per-torrent discussion thread between uploaders and moderators.
  - title: Bonus events
    details: Time-bounded Freeleech / Silverleech windows or any custom multipliers. Applied on the announce hot path; the snapshot is cached for 30 s in Redis.
  - title: Seed bonus economy
    details: Per-user points earned for seeding (rate-limited curves on torrent age, swarm rarity, seed count, …) and spent in an operator-curated shop on upload-credit or invites.
  - title: HTTP + UDP tracker
    details: Single Go binary speaks BEP 3 over HTTP/8080 and BEP 15 over UDP/6969. Stateless connection-id HMAC, BEP 41 URL_DATA carries the passkey, and the .torrent generator advertises both tiers.
  - title: User-managed invitations
    details: Members generate their own one-time codes from a dedicated page. Codes are masked from staff to remove the temptation to harvest. Three-state registration (open / invite-only / closed).
  - title: Built-in observability
    details: Prometheus metrics for moderation queue depth, 2FA adoption, bonus events, invitations funnel, registration mode, and more — exposed on a dedicated port.
  - title: Hit-and-Run tracking
    details: Built-in seeding requirements, exemption controls and moderator dashboards keep the swarm healthy.
  - title: Rich media metadata
    details: Pluggable provider abstraction with TMDb (movies/TV), IGDB (games) and Open Library + Google Books (books). The user's locale drives the lookup language so French users get French titles out of the box.
  - title: Multi-channel notifications
    details: In-app feed plus optional fan-out to SMTP, Telegram, Discord, Slack, Mattermost, ntfy, Gotify, Pushover, Webhook, Apprise — or system-level browser push via the Push API + service worker.
  - title: Anti-cheat detection
    details: Three real-time heuristics in the Go tracker (impossible velocity, upload to an empty swarm, unknown peer_id signature) feed a manual triage queue at /mod/anti-cheat. Nothing auto-bans.
  - title: Upload requests / bounty board
    details: Members post specific upload wishes and stake bonus points as a reward. The escrow is atomic, the timeout is operator-tunable, and the auto-validation cron is race-safe with the manual paths.
  - title: Social graph
    details: One-way follow on every profile, private "/following" cast list, opt-in upload notifications. Concurrency-capped fan-out keeps a hot uploader from storming the dispatch layer.
  - title: Cross-seed surface
    details: Content signatures group sibling torrents on the detail page. KPI tiles tell you how much of the current swarm is also active on a sibling — useful for planning low-risk migrations.
  - title: Timed bans
    details: Bans carry an optional duration. A 5-minute cron lifts expired rows and fires account_unbanned. Lazy unban at every auth boundary covers the gap before the cron ticks.
---

## Why Trackarr?

Trackarr is designed for communities that value **privacy** and **security** above all else. Unlike traditional trackers that store passwords and personal data in plaintext or with reversible encryption, Trackarr uses cryptographic proofs that make it mathematically impossible to recover user credentials — even for administrators.

This documentation covers the [`Dim145/opentracker`](https://github.com/Dim145/opentracker) fork, which adds two-factor auth, user-managed invitations, the moderation pipeline, bonus events, the [seed-bonus economy](/guide/seed-bonus) (per-user points + shop), the [UDP tracker frontend](/guide/udp-tracker) (BEP 15 alongside HTTP), the three-state registration mode, [pluggable media metadata](/guide/metadata-providers) (TMDb / IGDB / Open Library), [multi-channel notifications](/guide/notifications) (SMTP, Telegram, Discord, Web Push, …), a [community bounty board](/guide/upload-requests), a [follow / subscribe](/guide/follows) graph with upload notifications, [private favorites](/guide/favorites), a [cross-seed](/guide/cross-seed) surface on every torrent, [anti-cheat detection](/guide/anti-cheat) feeding a manual triage queue, and a hardened announce hot path on top of the original feature set.

### Tech Stack

| Layer    | Technology                          | Purpose                                |
| -------- | ----------------------------------- | -------------------------------------- |
| Frontend | Nuxt 4, Vue 3, Tailwind CSS         | SSR (or fully static SPA), Composition |
| Backend  | Nitro Server Engine                 | API routes, middleware                 |
| Tracker  | Go (custom)                         | HTTP announces, peer store, bonus mul. |
| Database | PostgreSQL 16 + Drizzle ORM         | Data persistence, full-text search     |
| Cache    | Redis 7                             | Peer lists, sessions, rate limiting    |
| Crypto   | Web Crypto API, scrypt, AES-256-GCM | ZKE auth, panic encryption             |
| 2FA      | otplib + @simplewebauthn            | TOTP + WebAuthn passkeys               |

---

## Getting Started

```bash
# Clone the repository
git clone https://github.com/Dim145/opentracker.git
cd opentracker
cp .env.example .env

# Generate the secrets that have no usable defaults
echo "IP_HASH_SECRET=$(openssl rand -hex 32)" >> .env
echo "NUXT_SESSION_SECRET=$(openssl rand -hex 32)" >> .env

# Bring up the data layer (Postgres + Redis)
docker compose up -d

# Start the app processes on the host (web + api + tracker)
pnpm install
pnpm dev

# Open http://localhost:3000 and register the first admin
```

For a production setup (Caddy + HTTPS + the three app containers
together), see the [Getting Started](/guide/getting-started)
guide.

See the [Getting Started](/guide/getting-started) guide for a deeper walk-through, or jump straight into the [Configuration](/guide/configuration) reference.
