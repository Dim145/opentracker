# API reference

Trackarr exposes three surfaces:

1. **Tracker endpoints** — `apps/tracker` (Go). Public, anonymous, BEP-spec'd. `/announce` over HTTP and UDP.
2. **REST API** — `apps/api` (Nitro). Everything under `/api/*`. Session-cookie auth.
3. **Torznab + RSS** — feed-style endpoints for *Arr clients and feed readers, keyed by passkey or Torznab API key.

The lists below are exhaustive against the route tree under `apps/api/routes/api/`. Auth labels: **public** (anonymous), **user** (any authenticated user), **mod** (`canModerate` permission), **admin** (admin role), **passkey** (announce-style, passkey in URL).

## Tracker endpoints

The Go tracker speaks two protocols off the same backend.

### HTTP announce (BEP 3) — `GET /announce`

```
GET /announce?info_hash=...&peer_id=...&port=...
            &uploaded=...&downloaded=...&left=...
            &event=started|completed|stopped&numwant=...&compact=1
```

Passkey is read from the path (`/announce/PASSKEY`) **or** the `?passkey=` query parameter. Response is the standard bencoded peer list.

### UDP announce (BEP 15) — `:6969/udp`

Stateless connect-then-announce. Passkey extracted from the BEP 41 URL_DATA option. See [UDP Tracker](../guide/udp-tracker.md) for the wire format, connection-id HMAC scheme, and reverse-proxy caveats.

::: warning No `/scrape`, no `wss://`
The tracker does not currently implement a multi-hash scrape endpoint or the WebTorrent (WebSocket) announce path. Don't advertise a `wss://` URL or a scrape URL in `.torrent` files — clients will hang.
:::

## Public (no auth)

| Method | Path                          | Purpose                                                                |
| ------ | ----------------------------- | ---------------------------------------------------------------------- |
| GET    | `/api/health`                 | Liveness probe. Returns `200 { ok: true }`.                            |
| GET    | `/api/branding`               | Site title, tagline, logo URL, favicon URL, feature flags.             |
| GET    | `/api/runtime-config`         | Public Nuxt runtime config (announce URLs, etc.) for the static SPA.   |
| GET    | `/api/announcement`           | Operator-set homepage banner (text + level).                           |
| GET    | `/api/homepage-content`       | Featured rails, custom blocks (operator-curated).                      |
| GET    | `/api/categories`             | Hierarchical category tree.                                            |
| GET    | `/api/tags`                   | Tag master list (autocomplete source).                                 |
| GET    | `/api/upload-rules`           | Public upload constraints (max size, allowed extensions, …).           |
| GET    | `/api/stats/public`           | Swarm counters (peers, seeders, torrents, users) + UDP toggle matrix.  |
| GET    | `/api/tracker-health`         | Tracker availability matrix (HTTP up/down, UDP up/down).               |
| GET    | `/api/torrents`               | Browse torrents (`page`, `limit`, `category`, `tags`, `q`, `sort`).    |
| GET    | `/api/torrents/:hash`         | Torrent detail (metadata + swarm + comments).                          |
| GET    | `/api/users/:id`              | Public profile (display name, role badges, redacts last-seen if opted out). |
| GET    | `/api/users/:id/uploads`      | Paginated list of `accepted` torrents from this user.                  |

## Authentication

Zero-Knowledge: the password never leaves the browser. See the [Zero-Knowledge Auth](../guide/zero-knowledge-auth.md) guide.

| Method | Path                       | Auth     | Purpose                                                                  |
| ------ | -------------------------- | -------- | ------------------------------------------------------------------------ |
| GET    | `/api/auth/pow`            | public   | Issue a Proof-of-Work challenge for the registration form.               |
| POST   | `/api/auth/register`       | public   | Create a user — body: `{ username, salt, verifier, invite?, pow }`.       |
| GET    | `/api/auth/challenge`      | public   | Return `{ salt, challenge }` keyed by username for the ZK login proof.   |
| POST   | `/api/auth/login`          | public   | Verify `{ username, proof, challenge }` and open a sealed-cookie session.|
| POST   | `/api/auth/logout`         | user     | Revoke the current session.                                              |
| GET    | `/api/auth/status`         | public   | Returns current user + locale + theme (or `null` if anonymous).          |
| PUT    | `/api/auth/password`       | user     | Atomic password rotation: prove current, ship new `{ salt, verifier }`.   |
| GET    | `/api/auth/passkey`        | public   | WebAuthn assertion options for first-factor passkey login.               |
| POST   | `/api/auth/passkey`        | public   | Verify a WebAuthn assertion and open a session.                          |

### Two-factor (during sign-in)

| Method | Path                                 | Auth     | Purpose                                                                  |
| ------ | ------------------------------------ | -------- | ------------------------------------------------------------------------ |
| POST   | `/api/auth/2fa/passkey-options`      | user (1FA)| WebAuthn options for the second-factor step.                            |
| POST   | `/api/auth/2fa/passkey-verify`       | user (1FA)| Verify the second-factor passkey, finalise the session.                 |
| POST   | `/api/auth/2fa/verify-totp`          | user (1FA)| Verify a 6-digit TOTP code (with optional `trust_device`).              |

### Two-factor enrolment (logged in)

| Method | Path                                              | Auth | Purpose                                          |
| ------ | ------------------------------------------------- | ---- | ------------------------------------------------ |
| GET    | `/api/me/2fa/status`                              | user | TOTP enabled? Passkey list? Trust-device flag?   |
| POST   | `/api/me/2fa/totp/setup`                          | user | Generate a TOTP secret + recovery codes.         |
| POST   | `/api/me/2fa/totp/enable`                         | user | Confirm with a 6-digit code → activates TOTP.    |
| POST   | `/api/me/2fa/totp/disable`                        | user | Disable TOTP (requires a fresh 6-digit code).    |
| POST   | `/api/me/2fa/recovery-codes/regenerate`           | user | Rotate the recovery code set.                    |
| POST   | `/api/me/2fa/passkey/register-challenge`          | user | WebAuthn attestation options to add a passkey.   |
| POST   | `/api/me/2fa/passkey/register-verify`             | user | Verify and store a new passkey.                  |
| DELETE | `/api/me/2fa/passkey/:id`                         | user | Remove a passkey by id.                          |
| GET    | `/api/me/2fa/sessions`                            | user | List trusted devices.                            |
| DELETE | `/api/me/2fa/sessions/:id`                        | user | Revoke a trusted device.                         |
| PUT    | `/api/me/2fa/trust-devices`                       | user | Toggle the "trust this browser for 30 days" flag.|

## Profile (`/me`)

| Method | Path                                  | Auth | Purpose                                                                  |
| ------ | ------------------------------------- | ---- | ------------------------------------------------------------------------ |
| GET    | `/api/me`                             | user | Full profile snapshot (KPIs, role badges, bio, locale, theme).           |
| PATCH  | `/api/me`                             | user | Update display name, bio, locale, theme, last-seen privacy toggle.       |
| GET    | `/api/me/downloads`                   | user | `.torrent` downloads + per-download HnR state.                           |
| GET    | `/api/me/seeds`                       | user | Active seeds with live swarm stats.                                      |
| GET    | `/api/me/bonus-history`               | user | Ledger of credited bonus points (paginated, oldest → newest).            |
| GET    | `/api/users/hnr`                      | user | Current user's HnR violations (shortcut).                                |

## Notifications

The in-app inbox is always-on; external channels are opt-in per user.

| Method | Path                                              | Auth | Purpose                                                                  |
| ------ | ------------------------------------------------- | ---- | ------------------------------------------------------------------------ |
| GET    | `/api/me/notifications`                           | user | Paginated inbox.                                                         |
| GET    | `/api/me/notifications/unread-count`              | user | Bell-badge count.                                                        |
| GET    | `/api/me/notifications/stream`                    | user | Server-Sent Events stream — live push to open tabs (Redis pub/sub fanout).|
| POST   | `/api/me/notifications/:id/read`                  | user | Mark a single row as read.                                               |
| POST   | `/api/me/notifications/read-all`                  | user | Mark every row as read.                                                  |
| GET    | `/api/me/notification-channels`                   | user | Channels configured for this user (and their state).                     |
| PUT    | `/api/me/notification-channels/:type`             | user | Configure / update a channel (encrypted at rest).                        |
| DELETE | `/api/me/notification-channels/:type`             | user | Disable a channel.                                                       |
| POST   | `/api/me/notification-channels/:type/test`        | user | Send a test notification through this channel.                           |
| PUT    | `/api/me/notification-routing`                    | user | Map `{notification_type → channel_type}` for fan-out.                    |

See [Notifications](../guide/notifications.md) for the channel types (SMTP, Telegram, Discord, ntfy, Gotify, Pushover, Slack, Mattermost, webhook, Apprise, **Web Push**).

## Torrents

| Method | Path                                             | Auth          | Purpose                                                                  |
| ------ | ------------------------------------------------ | ------------- | ------------------------------------------------------------------------ |
| GET    | `/api/torrents`                                  | public        | List/browse with filters.                                                |
| POST   | `/api/torrents`                                  | user          | Upload (multipart: `.torrent` + metadata + optional NFO).                |
| POST   | `/api/torrents/check`                            | user          | Pre-flight infohash lookup before opening the upload form.               |
| GET    | `/api/torrents/:hash`                            | public        | Detail page payload.                                                     |
| PATCH  | `/api/torrents/:hash`                            | uploader / mod| Edit title / description / tags / external IDs.                          |
| DELETE | `/api/torrents/:hash`                            | uploader / mod| Soft-delete.                                                             |
| GET    | `/api/torrents/:hash/download`                   | user          | `.torrent` with the user's passkey baked into the announce list.         |
| PUT    | `/api/torrents/:hash/tags`                       | uploader / mod| Replace the tag set.                                                     |
| POST   | `/api/torrents/:hash/comments`                   | user          | Post a comment.                                                          |
| DELETE | `/api/torrents/comments/:id`                     | author / mod  | Delete a comment.                                                        |
| GET    | `/api/torrents/:hash/moderation/messages`        | thread†       | Moderation chat — `{status, messages}`. 404 if not allowed.              |
| POST   | `/api/torrents/:hash/moderation/messages`        | thread†       | Reply without a status change.                                           |
| GET    | `/api/debug/:hash`                               | mod           | Raw row + per-peer swarm dump.                                           |

† `thread` = uploader of the row OR any staff member.

### Reports (user-side)

| Method | Path                  | Auth | Purpose                                                                  |
| ------ | --------------------- | ---- | ------------------------------------------------------------------------ |
| POST   | `/api/reports`        | user | Submit a report (`{ target_type, target_id, reason }`). See [Moderation — Reports](../guide/moderation.md#reports). |

## Moderation

| Method | Path                                            | Auth | Purpose                                                                  |
| ------ | ----------------------------------------------- | ---- | ------------------------------------------------------------------------ |
| GET    | `/api/mod/dashboard`                            | mod  | Counters: pending uploads, pending reports, HnR violations, …            |
| GET    | `/api/mod/torrents/pending`                     | mod  | Pending upload queue.                                                    |
| POST   | `/api/mod/torrents/:hash/approve`               | mod  | Move row → `accepted`. Optional message.                                 |
| POST   | `/api/mod/torrents/:hash/request-changes`       | mod  | Move row → `changes_requested`. **Message required.**                   |
| POST   | `/api/mod/torrents/:hash/reject`                | mod  | Move row → `rejected`. **Message required.**                            |
| POST   | `/api/mod/torrents/:hash/reset`                 | mod  | Only path out of `rejected`. **Message required.**                      |

## Forum

| Method | Path                                       | Auth        | Purpose                                                                  |
| ------ | ------------------------------------------ | ----------- | ------------------------------------------------------------------------ |
| GET    | `/api/forum/categories`                    | public      | Forum structure.                                                         |
| GET    | `/api/forum/categories/:id`                | public      | Category + paginated topics.                                             |
| POST   | `/api/forum/categories`                    | admin       | Create a category.                                                       |
| PUT    | `/api/forum/categories/:id`                | admin       | Edit a category.                                                         |
| DELETE | `/api/forum/categories/:id`                | admin       | Remove a category.                                                       |
| POST   | `/api/forum/topics`                        | user        | Create a topic.                                                          |
| GET    | `/api/forum/topics/:id`                    | public      | Topic + paginated posts.                                                 |
| DELETE | `/api/forum/topics/:id`                    | author / mod| Delete topic.                                                            |
| PUT    | `/api/forum/topics/:id/pin`                | mod         | Toggle pin.                                                              |
| PUT    | `/api/forum/topics/:id/lock`               | mod         | Toggle lock.                                                             |
| POST   | `/api/forum/posts`                         | user        | Reply in a topic.                                                        |
| PATCH  | `/api/forum/posts/:id`                     | author / mod| Edit a post.                                                             |
| DELETE | `/api/forum/posts/:id`                     | author / mod| Delete a post.                                                           |
| GET    | `/api/forum/stats`                         | public      | Aggregate stats (topic count, post count, latest reply).                 |

## Bonus economy & shop

| Method | Path                              | Auth   | Purpose                                                                  |
| ------ | --------------------------------- | ------ | ------------------------------------------------------------------------ |
| GET    | `/api/bonus/active`               | public | Active freeleech / silverleech / custom events.                          |
| GET    | `/api/shop/items`                 | user   | Shop catalogue.                                                          |
| POST   | `/api/shop/buy`                   | user   | Purchase an item (`{ item_id }`). Transactional against `users.bonus_points`. |

## Invitations

| Method | Path                          | Auth | Purpose                                                                  |
| ------ | ----------------------------- | ---- | ------------------------------------------------------------------------ |
| GET    | `/api/invites`                | user | My invite codes (remaining quota + outstanding codes).                   |
| POST   | `/api/invites`                | user | Generate a code (decrements `users.invites_remaining`).                  |
| DELETE | `/api/invites/:id`            | user | Revoke an unused code.                                                   |

## Metadata lookup

Filename → external metadata (TMDb / IGDB / Open Library / Google Books). Locale-aware via the user's profile setting.

| Method | Path                                  | Auth | Purpose                                                                  |
| ------ | ------------------------------------- | ---- | ------------------------------------------------------------------------ |
| GET    | `/api/metadata/search`                | user | Multi-source search (auto-routes by category type).                      |
| GET    | `/api/metadata/lookup`                | user | Resolve a known external id to a normalised payload.                     |

A missing provider key returns `503` only on the routes that need that source — the others keep serving. See [Metadata providers](../guide/metadata-providers.md).

## Torznab & RSS

Exposed for *Arr clients (Sonarr / Radarr / …) and feed readers.

| Method     | Path                              | Auth      | Purpose                                                              |
| ---------- | --------------------------------- | --------- | -------------------------------------------------------------------- |
| GET / HEAD | `/api/torznab/api`                | torznab key| Newznab/Torznab dispatcher (`?t=caps|search|tvsearch|movie|...`).   |
| GET        | `/api/torznab/download`           | torznab key| Download a `.torrent` keyed by `r=<torznab-key>`.                   |
| GET        | `/api/rss/latest`                 | public    | Recent torrents (Atom feed).                                         |
| GET        | `/api/rss/category/:slug`         | public    | Category-scoped feed.                                                |

See [Torznab integration](../integrations/torznab.md) for the *Arr-client wiring.

## Admin

The admin surface is gated by the `canAccessAdmin` permission. Auth = **admin** below.

### Users & roles

| Method | Path                                          | Purpose                                                              |
| ------ | --------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/users`                            | Paginated registry with KPI strip + filters.                         |
| POST   | `/api/admin/users/:id/ban`                    | Ban (auto-banlist the last-known IP).                                |
| POST   | `/api/admin/users/:id/unban`                  | Unban (does not auto-remove the IP banlist row).                     |
| PUT    | `/api/admin/users/:id/role`                   | *Deprecated.* Use the role-attach endpoints below.                   |
| GET    | `/api/admin/users/:id/roles`                  | List a user's roles.                                                 |
| POST   | `/api/admin/users/:id/roles`                  | Attach a role.                                                       |
| DELETE | `/api/admin/users/:id/roles/:roleId`          | Detach a role.                                                       |
| POST   | `/api/admin/users/:id/bonus-points`           | Add or subtract bonus points with an audit-logged reason.            |
| GET    | `/api/admin/roles`                            | Role catalogue.                                                      |
| POST   | `/api/admin/roles`                            | Create a role.                                                       |
| PUT    | `/api/admin/roles/:id`                        | Edit role (name, permissions, auto-assignment rules).                |
| DELETE | `/api/admin/roles/:id`                        | Remove a role.                                                       |
| POST   | `/api/admin/roles/recompute`                  | Re-evaluate every user against auto-assignment rules.                |

See [Roles & Permissions](../guide/roles-and-permissions.md).

### Settings, branding, system

| Method | Path                                  | Purpose                                                              |
| ------ | ------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/settings`                 | All site settings (title, tagline, force-2FA scope, retention, …).   |
| PUT    | `/api/admin/settings`                 | Save settings.                                                       |
| POST   | `/api/admin/logo`                     | Upload the site logo (multipart).                                    |
| POST   | `/api/admin/favicon`                  | Upload the favicon (multipart).                                      |
| GET    | `/api/admin/stats`                    | Live aggregate stats (users, torrents, peers, DB size).              |
| GET    | `/api/admin/stats/history`            | Time-series for the admin charts.                                    |
| GET    | `/api/admin/system/version`           | Current version + commit + runtime label.                            |
| GET    | `/api/admin/system/update`            | Latest release available on GitHub (queries `TRACKARR_REPO`).        |

See [Branding](../guide/branding.md).

### Categories & tags

| Method | Path                              | Purpose                                                              |
| ------ | --------------------------------- | -------------------------------------------------------------------- |
| POST   | `/api/admin/categories`           | Create a category.                                                   |
| PUT    | `/api/admin/categories/:id`       | Edit a category.                                                     |
| DELETE | `/api/admin/categories/:id`       | Remove a category.                                                   |
| POST   | `/api/admin/categories/seed`      | Seed the default category tree (idempotent — skips existing rows).   |
| POST   | `/api/admin/tags`                 | Create a tag.                                                        |
| DELETE | `/api/admin/tags/:id`             | Delete a tag (unbinds it from every torrent in the same transaction).|

### Upload rules

| Method | Path                              | Purpose                                                              |
| ------ | --------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/upload-rules`         | Read rules (NFO requirement, description min length, regex patterns).|
| PUT    | `/api/admin/upload-rules`         | Update rules (atomic).                                               |

See [Upload Rules](../guide/upload-rules.md).

### Bonus rules & events

| Method | Path                                                | Purpose                                                              |
| ------ | --------------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/bonus-rules`                            | Read all rules + tier sets.                                          |
| PATCH  | `/api/admin/bonus-rules/rule/:kind`                 | Configure a rule (`seeding`, `first_seeder`, `daily_login`, …).      |
| POST   | `/api/admin/bonus-rules/tiers/seed-count`           | Add a seeder-count tier.                                             |
| PATCH  | `/api/admin/bonus-rules/tiers/seed-count/:id`       | Edit a seeder-count tier.                                            |
| DELETE | `/api/admin/bonus-rules/tiers/seed-count/:id`       | Remove a tier.                                                       |
| POST   | `/api/admin/bonus-rules/tiers/age`                  | Add a torrent-age tier.                                              |
| PATCH  | `/api/admin/bonus-rules/tiers/age/:id`              | Edit an age tier.                                                    |
| DELETE | `/api/admin/bonus-rules/tiers/age/:id`              | Remove an age tier.                                                  |
| GET    | `/api/admin/bonus-events`                           | List scheduled events.                                               |
| POST   | `/api/admin/bonus-events`                           | Create a Freeleech / Silverleech / custom event.                     |
| PATCH  | `/api/admin/bonus-events/:id`                       | Edit an event.                                                       |
| DELETE | `/api/admin/bonus-events/:id`                       | Cancel an event.                                                     |
| POST   | `/api/admin/bonus-events/:id/toggle`                | Pause / resume a running event.                                      |
| GET    | `/api/admin/shop/items`                             | Shop catalogue (admin view).                                         |
| POST   | `/api/admin/shop/items`                             | Add a shop item.                                                     |
| PATCH  | `/api/admin/shop/items/:id`                         | Edit a shop item.                                                    |
| DELETE | `/api/admin/shop/items/:id`                         | Remove a shop item.                                                  |

### HnR

| Method | Path                          | Purpose                                                              |
| ------ | ----------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/hnr`              | List violations.                                                     |
| PUT    | `/api/admin/hnr/:id`          | Mark exempt / cleared / unresolved.                                  |

See [Hit-and-Run](../guide/hit-and-run.md).

### Banned IPs

| Method | Path                              | Purpose                                                              |
| ------ | --------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/banned-ips`           | List banlist entries.                                                |
| POST   | `/api/admin/banned-ips`           | Add an IP banlist row.                                               |
| DELETE | `/api/admin/banned-ips/:ip`       | Remove an IP banlist row.                                            |

### Invitations

| Method | Path                                  | Purpose                                                              |
| ------ | ------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/invites`                  | Every invite code + usage state.                                     |
| POST   | `/api/admin/invites/generate`         | Batch-generate codes (operator share link).                          |
| POST   | `/api/admin/invites/grant`            | Award invite quota to a user.                                        |
| DELETE | `/api/admin/invites/:id`              | Revoke a code.                                                       |

See [Invitations](../guide/invitations.md).

### Reports

| Method | Path                          | Purpose                                                              |
| ------ | ----------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/reports`          | Queue (paginated, filterable by target_type and status).             |
| PUT    | `/api/admin/reports/:id`      | Resolve a report (status + action note).                             |

### Notification channels (server-side config)

| Method | Path                                                     | Purpose                                                              |
| ------ | -------------------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/notification-channels`                       | List configured channels + capability matrix.                        |
| PUT    | `/api/admin/notification-channels/:type`                 | Configure a channel (SMTP host, Discord token, VAPID keys, …).       |
| POST   | `/api/admin/notification-channels/:type/test`            | Send a test through this channel (uses the admin's own user as recipient). |

### Torznab admin

| Method | Path                                              | Purpose                                                              |
| ------ | ------------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/torznab`                              | Torznab config + per-user key inventory.                             |
| PUT    | `/api/admin/torznab`                              | Toggle Torznab + edit limits.                                        |
| GET    | `/api/admin/torznab/users`                        | Active user keys.                                                    |
| POST   | `/api/admin/torznab/users/:id/block`              | Revoke a user's Torznab key.                                         |
| POST   | `/api/admin/torznab/users/:id/reset`              | Rotate a user's Torznab key.                                         |
| GET    | `/api/admin/torznab/blacklist`                    | Query patterns currently blacklisted.                                |
| POST   | `/api/admin/torznab/unblock`                      | Lift a blacklist entry.                                              |
| GET    | `/api/admin/torznab/logs`                         | Recent Torznab requests with status + handler.                       |
| GET    | `/api/admin/torznab/stats`                        | Aggregate request counters by handler.                               |

### Panic Mode

| Method | Path                          | Purpose                                                              |
| ------ | ----------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/panic`            | Encryption state + last-activation timestamp.                        |
| POST   | `/api/admin/panic/encrypt`    | Activate. Body: `{ confirmation: "ENCRYPT_ALL_DATA" }`.              |
| POST   | `/api/admin/panic/restore`    | Restore. Body: `{ password }`.                                       |

See [Panic Mode](../guide/panic-mode.md). Activation is **irreversible without the original password** — operators are warned in-app.

### Debug

| Method | Path                                          | Purpose                                                              |
| ------ | --------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/admin/debug/tracker-status`             | Raw tracker health + peer counter snapshot.                          |
| GET    | `/api/admin/debug/redis-peers`                | Peer hash sample for one info_hash.                                  |
| GET    | `/api/admin/debug/redis-all-peers`            | Full SCAN over `peers:*`. Heavy — use sparingly.                     |

## Rate limits

The API enforces sliding windows in Redis. Limits are tuned in `apps/api/utils/rateLimit.ts` and are not env-driven today.

| Bucket                | Limit       | Window |
| --------------------- | ----------- | ------ |
| Public read           | 100 req     | 1 min  |
| Mutations (POST/PUT/PATCH/DELETE) | 10 req | 1 min |
| Auth (`/api/auth/*`)  | 5 req       | 5 min  |
| Tracker announce      | 200 req     | 1 min  |

Exceeding a bucket returns `429 Too Many Requests`. Repeated offences within a short window add a temporary IP ban — see [Security](../guide/security.md).

## Error shape

Every error response uses h3's default shape:

```json
{
  "url": "/api/example",
  "statusCode": 429,
  "statusMessage": "Too Many Requests",
  "message": "Rate limit exceeded",
  "data": {}
}
```

Common status codes:

| Code | Meaning                                                              |
| ---- | -------------------------------------------------------------------- |
| 400  | Validation failed (Zod body / query schema).                         |
| 401  | Not authenticated (no session cookie).                               |
| 403  | Authenticated but lacking the required permission/role.              |
| 404  | Resource not found, OR (deliberate) hidden — see Moderation thread.  |
| 409  | Conflict (e.g. duplicate `info_hash` on upload, role-rule collision).|
| 429  | Rate limited.                                                        |
| 500  | Server error — surface to the operator via `LOG_LEVEL=error`.        |
