# Roadmap

Trackarr is actively developed with a focus on performance, security, and usability. The fork at [`Dim145/opentracker`](https://github.com/Dim145/opentracker) tracks against this roadmap.

## Released

### v0.21.x — Freeleech pool, observability, security hardening

- [x] **Freeleech pool** — Community-funded pot in the shop: members stake bonus points; when the target is reached a site-wide freeleech fires for a configured duration, then the pool drains and reopens. Admin-tunable target / duration / per-user cap / preset amounts, optional contribution windows (one-off, weekly, monthly, yearly), top-contributor board, and graceful interaction with an already-running bonus event. See [Freeleech pool](./freeleech-pool.md).
- [x] **Anti-cheat triage upgrades** — `no_leecher` flags aggregate to one open row per (user, torrent) (the tracker upserts and sums the claimed bytes) instead of flooding the queue; the `/mod/anti-cheat` page gains bulk select + bulk verdict.
- [x] **Observability** — Prometheus metrics extended to every recent surface (anti-cheat, bounty board, follows/favorites, cross-seed, timed bans, bonus shop, freeleech pool) on a dedicated port, plus a ready-to-import Grafana overview dashboard. A Docker `/health` probe is baked into the tracker image.
- [x] **Security hardening pass** — Multi-stage adversarial audit + remediation: panic-mode key no longer derivable from a DB dump, ratio-economy re-credit loop closed, the 2FA fresh-auth window made functional (+ step-up on authenticator enrolment), trusted-device revocation on password change, SSRF closed on the Mattermost/Web-Push channels, demoted-staff role re-validation, TOTP single-use, `.torrent` ingestion hardened (private-flag normalisation so info_hash can't drift, size/length/file-count caps), and a long tail of medium/low fixes. **Breaking:** `IP_HASH_SECRET` and `NUXT_SESSION_SECRET` must now be ≥ 32 chars, and panic-mode encryption requires the panic password in the request.

### v0.20.x — Social graph, bounty board, anti-cheat

- [x] **Anti-cheat detection** — Three real-time heuristics in the Go tracker (impossible velocity, upload to empty swarm, unknown peer_id signature) feeding a manual triage queue at `/mod/anti-cheat`. Nothing auto-bans. See [Anti-cheat](./anti-cheat.md).
- [x] **Cross-seed surface** — Content signatures on every torrent, sibling listing on the detail page, "cross-seed peers" + "volume share" KPI tiles. See [Cross-seed](./cross-seed.md).
- [x] **Favorites** — Star toggles on torrent detail + every listing row, private catalogue at `/favorites` styled as a letterpress library card index. See [Favorites](./favorites.md).
- [x] **Follow / subscriber graph** — One-way follow on `/users/:id`, `followed_user_upload` notifications on accepted uploads, private `/following` "Dramatis Personae" page. Fan-out concurrency-capped to 20 workers. See [Follows](./follows.md).
- [x] **User reports** — Filing flow from torrent detail, user profile, and forum posts. Withdrawal of pending reports from `/me/reports`. See [Reports](./reports.md).
- [x] **Ban-on-report-resolution + timed bans** — Six-option sanction picker (None / 1d / 7d / 1m / 1y / Permanent) when accepting a user report; `banned_until` column + 5-minute auto-unban cron + lazy unban at login/Torznab/tracker. See [Reports](./reports.md#user-reports-ban-on-resolution).
- [x] **Upload requests / bounty board** — Full `/requests` market with reward escrow, per-user fill cap, auto-validation cron, comment threads. Admin-tunable timeout + max fills. See [Upload Requests](./upload-requests.md).
- [x] **Concurrency hardening** — Conditional-UPDATE pattern (`WHERE status='<expected>' RETURNING id`) across the bounty board's validate/cancel/fill/auto-validate paths to prevent double-payment / double-refund races.

### v0.17.x — Metadata layer, Web Push, upload polish

- [x] **Pluggable metadata providers** — TMDb (films / TV), IGDB (games), Open Library + Google Books fallback (books). One registry, one `MediaSource` contract; new sources slot in with one file.
- [x] **Locale-aware lookups** — User's `/settings` language drives the TMDb `language` query and is part of the Redis cache key
- [x] **Browser push notifications (Web Push)** — VAPID-signed system notifications via a service worker, plugged into the existing channel registry alongside SMTP / Telegram / Discord / ntfy / Gotify / Pushover / webhook / Apprise
- [x] **Upload form refinements** — Category-aware release-name parser (game / book / film / TV token tables), duplicate-infohash preflight, source-aware metadata preview, automatic id reset on category change
- [x] **Bonus collector restart safety** — Cross-replica Redis lock and persisted last-tick timestamp; restarts no longer hand out a free hourly credit

### v0.14–v0.16 — Notifications + i18n

- [x] **In-app notifications** — Bell icon + `/notifications` feed, polymorphic event table, Redis pub/sub fan-out across Nitro replicas, retention sweeper
- [x] **External notification channels** — SMTP, Telegram, Discord, Slack, Mattermost, ntfy, Gotify, Pushover, generic webhook, Apprise
- [x] **Seed-bonus economy** — Customisable per-minute earning rules (rate × age × rarity curves), bonus shop, transactional buy flow, ledger-deduped grants
- [x] **Internationalization** — `vue-i18n` + `@nuxtjs/i18n` with English + French bundles; user-saved preference on `users.language`

### v0.13.x — Moderation, 2FA, bonus events

- [x] **Two-Factor Auth** — TOTP with recovery codes, WebAuthn passkeys, trusted-device cookies, A+C re-auth pattern, admin-controlled enforcement scope (off / staff / all)
- [x] **User-managed invitations** — Members generate their own one-time codes with custom expiry; admins see masked previews only; three-state registration mode (open / invite-only / closed)
- [x] **Torrent moderation pipeline** — `pending` / `accepted` / `changes_requested` / `rejected` lifecycle with a per-torrent discussion thread; rejected rows kept on file to block re-uploads of the same info-hash
- [x] **Bonus events** — Time-bounded Freeleech / Silverleech / custom multiplier windows applied on the announce hot path; advisory-locked overlap check guards against concurrent admin writes
- [x] **Hardening pass** — Int64 overflow guard on announce deltas, advisory locks on bonus-events + first-user register, Redis-backed caches on `requireAuthSession` and `userCanBypassModeration`
- [x] **Prometheus metrics expansion** — torrents-by-status, users-by-role, 2FA adoption, invitations funnel, bonus events, registration mode

### v0.12.x — Tracker enhancements

- [x] **Custom Branding** — Logo, favicon, site name, colors, font weight
- [x] **Invitation System** — Private invite codes with per-user limits (now reworked in 0.13 — see Operations / Invitations)
- [x] **Registration Modes** — Open, invite-only, or closed registration
- [x] **Hit and Run Tracking** — Track users who don't seed minimum time
- [x] **Tags & Categories** — Flexible labels and admin category management
- [x] **Reports & Moderation** — Flag content for moderation review
- [x] **Homepage Customization** — WYSIWYG editor for homepage content
- [x] **Panic Mode** — Emergency lockdown system
- [x] **Static SPA build** — Optional `nuxi generate` build served by distroless nginx (~10× less RAM than the SSR path)

---

## In progress / next

- [ ] **User Classes** — Power User, VIP with granular permissions on top of the existing role engine
- [ ] **Edit UI on requests** — The `PATCH /api/requests/:id` endpoint exists and handles bump-only reward + title/desc/category edits; the inline detail-page form is the missing piece.
- [ ] **Withdrawn-reports audit trail** — Currently a pending report can be hard-deleted from `/me/reports`. A tombstone for "pattern of withdrawn reports" would help catch bad-faith reporters.

---

## Later

- [ ] **Plugin Architecture** — Admin-activatable modules
- [ ] **Private Messages** — User-to-user inbox system
- [ ] **Collages / Collections** — Group torrents by theme
- [ ] **Theme System** — Custom theme support beyond the built-in dark/light pair
- [ ] **E2E Tests** — Complete functional test suite
- [ ] **API Documentation** — OpenAPI/Swagger at `/api/docs`

---

## Future (v1.x+)

- [ ] Federation — Inter-tracker communication
- [ ] Mobile app companion
- [ ] CLI tool for tracker management
- [ ] Distributed tracker (multi-node)

---

> [!NOTE]
> This roadmap is subject to change based on feedback and priorities. Have a feature request? Open an issue on [GitHub](https://github.com/Dim145/opentracker/issues).
