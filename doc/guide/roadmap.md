# Roadmap

Trackarr is actively developed with a focus on performance, security, and usability. The fork at [`Dim145/opentracker`](https://github.com/Dim145/opentracker) tracks against this roadmap.

## Released

### v0.35.x — Staff audit log, BEP 52 announce, data export, installable app

- [x] **Staff audit log** — Every mutating request to `/api/admin/**` and `/api/mod/**` now leaves one row: actor and role as they were at the time, a stable action key, target, what changed, and the HTTP status — refusals included, since a run of 403s from one account is the pattern such a register exists to surface. Written by a pair of Nitro hooks rather than by each route, so coverage is structural: a staff route added tomorrow is audited before anybody writes a line for it. Append-only (no edit path, no per-row delete); rows leave only through a retention sweep whose period is published on the public `/privacy` page. Read by admins only — moderators fill the table and cannot read it. Request bodies are never captured; the settings route records which settings were touched, never their values. See [Staff audit log](./audit-log.md).
- [x] **BEP 52 announce** — A v2 or hybrid torrent announces under a second infohash (SHA-256 truncated to 20 bytes), and the tracker only ever looked up `info_hash`. So a hybrid torrent errored on every second announce and its swarm was split, with v1-only and v2-capable peers keyed apart in Redis and unable to see each other. The announce path now tries v1 first (unchanged, one unique-index hit) and falls back to a partial expression index over `left(info_hash_v2, 40)`, returning the canonical hash as the swarm key — which is what merges the two halves. `/scrape` does the same over both transports, bounded to 8 lookups per request. `info_hash_v2` itself was being hashed over a re-encoding of the decoded info dict, which is the same value for a canonical torrent and a different one for anything else; it is now hashed over the file's original bytes, located by a bencode range scanner, and back-filled over the existing catalogue. See [BitTorrent v2](./bittorrent-v2.md).
- [x] **Torznab: seeding obligations and infohash** — The feed now emits `minimumratio`, `minimumseedtime` and `infohash`. The first two are the numbers the tracker already enforces — a minimum ratio at announce time, a required seed time as a hit-and-run sanction — and until now nobody was told them in advance; sent through the channel Sonarr and Radarr already read, they turn hit-and-run from a trap into a contract. Both are omitted rather than sent as `0` when the site imposes neither. The volume factors, hard-coded to `1` since the feed shipped, now reflect the running bonus event: the feed was telling *Arr clients "normal rates" during a site-wide freeleech. Mirrored (federated) items carry the hash but no obligations — those belong to the instance that holds the release. See [Torznab](../integrations/torznab.md).
- [x] **Data export (GDPR Art. 15 / 20)** — Erasure (Art. 17) has been here since the account page; the access and portability half had not, even though the erasure had already settled what counts as a member's data and a dozen `/api/me/*` routes were reading most of it a page at a time. One request now returns the record as a record: one JSON document, behind the same fresh-auth step-up erasure uses, with every collection capped and declaring its own true total. Credentials, private-message bodies, other members' identities and anti-cheat findings are excluded, and the file lists every omission with its reason. See [Your data](./your-data.md).
- [x] **Installable app (PWA)** — A manifest served by the API, so the app's name, colours and icon follow the instance's branding instead of being baked into the bundle; plus the service worker (which has been the Web Push receiver all along) registered on page load rather than only when a member enables notifications, since a browser decides installability at load time. Icon `sizes` is measured from the uploaded image's own header rather than asserted — Chrome installs on the strength of that claim, and a fabricated `512x512` buys an install prompt and a blurry icon. No offline mode: every page here is a live view of a swarm, and a cache-first worker would serve yesterday's ratio with no way for the reader to tell. See [Install as an app](./install-as-app.md).

### v0.34.x — Private messaging

- [x] **Private messages** — Direct conversations with optional end-to-end encryption, reactions, replies, edits, read receipts, archiving and search; a staff half with broadcasts and pinned messages; blocking that covers every route into a conversation; retention periods published on `/privacy`. Ships disabled. See [Messaging](./messaging.md).
- [x] **Support tickets** — A way to reach the staff that blocking cannot close, with categories, assignment and closure reasons.

### v0.33.x — Configurable themes

- [x] **Theme system** — Operator-authored themes beyond the built-in dark/light pair: a token set per theme, a `System` mode mapping two of them onto the OS preference, uploaded fonts, and a per-response stylesheet at `/api/theme.css` that is render-blocking in both the SSR and static shapes so the first paint is already the right one. See [Themes](./themes.md).

### v0.26.x — Report tombstones, federation health, generated OpenAPI

- [x] **Withdrawn-report tombstones** — Withdrawing a pending report used to hard-delete the row, which meant someone could file and pull reports in series and leave no trace. The row now survives as `withdrawn` and leaves the reporter's own list entirely — from their side nothing changed — while moderation gains a Withdrawn filter and, beside each reporter, how many reports they have withdrawn overall, shown from two upward. See [Reports](./reports.md).
- [x] **Federation health panel** — `federation_sync_state` had recorded last run, cursor, item count and error per (peer, resource) since federation shipped, and nothing read it back; a partner failing every tick stayed invisible. `/admin/federation` now shows a heartbeat gauge that fills as time since the last run approaches the stale threshold, a coloured rail per peer, a per-resource ledger, and errors printed in full. The verdict is computed server-side, since "stale" only means anything against the real sync interval, and a peer's verdict is the worst of its resources. See [Federation](./federation.md).
- [x] **Generated OpenAPI** — The spec is derived from the source Nitro itself uses, the route file names: 243 operations over 203 paths at `/api/docs/openapi.json`. Path, method, path parameters and the authentication requirement are read from the code and cannot drift. Request bodies come from the validation call each route already makes, and the 21 shared schemas are converted by Zod 4's own `z.toJSONSchema()`. Response shapes and handler-local schemas are deliberately out of scope rather than guessed at. Generation runs as part of the build.

### v0.25.x — Full-text search

- [x] **Full-text catalogue search** — Search moved off `name ILIKE '%term%'` onto PostgreSQL full-text: one GIN index per field (name, description, NFO, tag names), and a setting at `/admin/settings` deciding which of them a query reads. One index per field rather than a single weighted vector is what makes that setting real — each enabled field adds a branch to the `OR`, served by its own index. No extension and no extra service: `to_tsvector` and GIN have been core Postgres since 8.3. The last term carries a `:*` so the bar completes as you type, and a `word_similarity` pass catches typos when full-text finds nothing — expensive enough (223 ms against 60) that an operator can switch it off for a large catalogue or a strained server. Searching by infohash or by IMDb/TMDb/TVDB link is untouched. Measured over 200k torrents: 52 ms for a name search against 184 ms before, 28 ms for a word only present in a description (previously unfindable).

### v0.24.x — Release sheet builder

- [x] **Release sheet builder** — A four-step wizard at `/torrents/fiche`, reachable from the upload form, that turns a video file into a BBCode release sheet, an NFO and a normalised release name, then hands all three back to the upload form. MediaInfo runs in the browser through WebAssembly and only reads the chunks it asks for, so nothing about the file leaves the machine. Measured quantities are modelled in base units (bit/s, bytes) with the unit kept as a display preference, which is what makes the Kbps/Mbps and MiB/GiB selectors non-destructive. Every dropdown keeps an "Other…" entry, and a value from MediaInfo matching no entry switches to free text by itself. Sending a sheet to the upload form disables only the editor's visual mode — source mode and preview stay available, so the BBCode is still editable and still previewable.

### v0.22.x — Federation

- [x] **Federation (axes 1-4)** — Inter-tracker communication between Trackarr instances, double opt-in at the handshake with per-peer scopes and signed requests. Catalogue mirroring with persisted per-resource cursors, an append-forward create feed plus a separate `catalog-refresh` feed cursored on `torrents.updated_at` so metadata edits and re-approvals propagate to partner mirrors. Tombstone channel for removals. Per-peer row and page caps so a misbehaving partner cannot grow the mirror without bound; Redis lock so a single API replica syncs per tick; silent initial backfill. Federated forum, remote torrent comments, ban-aware identity and reputation lookups, and swarm cross-announce. Verified on a three-instance mesh. See [Federation](./federation.md).

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

- [ ] **Persisted torrent groups** — Releases of the same work are grouped in the browser, on the current page only, keyed on the external metadata id. Promoting that to a stored group entity would let it survive pagination, carry a group page and aggregate stats. The cross-seed content signatures already answer "these two torrents are the same work".
- [ ] **User Classes** — Power User, VIP with granular permissions on top of the existing role engine
- [ ] **Protocol version negotiation** — The federation proposal reserves an envelope `v` field and capability negotiation at the handshake. Worth confirming end-to-end before the next protocol bump, so a mixed-version mesh fails loudly rather than drifting.

---

## Later

- [ ] **Plugin Architecture** — Admin-activatable modules
- [ ] **Collections** — Member-curated groupings by theme, with suggestions and a bulk `.torrent` download. Distinct from the persisted **groups** above, which are releases of the same work keyed on a metadata id: one is editorial, the other is identity, and conflating them is what made this line ambiguous for three releases.
- [ ] **OpenAPI response schemas** — The generated spec covers paths, methods, auth and shared request bodies. Response shapes, and the bodies of the ~70 routes that declare their schema inside the handler closure, need a convention change before static analysis can reach them honestly.
- [ ] **API docs viewer** — The spec is served raw; a bundled viewer (Swagger UI / Scalar) would need packaging, since the CSP rules out a CDN.
- [ ] **E2E Tests** — Complete functional test suite. Priority within this bucket: the money paths (bonus accrual, bounty escrow, freeleech pool), which are the least covered relative to what they move.

---

## Future (v1.x+)

- [ ] Mobile app companion
- [ ] CLI tool for tracker management
- [ ] Distributed tracker (multi-node)

---

> [!NOTE]
> This roadmap is subject to change based on feedback and priorities. Have a feature request? Open an issue on [GitHub](https://github.com/Dim145/opentracker/issues).
