# Notifications

Trackarr delivers two parallel notification surfaces:

1. **In-app feed** — the bell in the header + `/notifications` page.
   Always on; backed by a row per event in Postgres, fanned out
   over Redis pub/sub + SSE so a notification lands within a second
   even across Nitro replicas.
2. **External channels** — opt-in transports the user configures
   from `/settings → Notifications`. Each event type can be routed
   to one channel (or kept in-app only).

The two halves don't compete: every event always lands in the feed,
and **additionally** dispatches through the user's routing if one is
set. A failure on the external side never blocks the in-app row.

## Supported channels

| Channel | Server config | User config | Notes |
| --- | --- | --- | --- |
| **SMTP / email** | host, port, user, password, from address | recipient address | TLS or STARTTLS, plain or AUTH LOGIN. |
| **Telegram** | bot token | chat id | One-tap setup via `@BotFather`. |
| **Discord** | — | webhook URL | Pure-webhook, no admin config. |
| **Slack** | — | webhook URL | Pure-webhook. |
| **Mattermost** | — | webhook URL | Pure-webhook. |
| **ntfy.sh** | base URL, optional auth header | topic, priority | Self-hostable. |
| **Gotify** | base URL, app token | priority | Self-hosted only. |
| **Pushover** | application API token | user key, priority | Paid commercial service. |
| **Webhook** | optional HMAC secret | URL, headers | Generic JSON POST. Loopback / private hosts are blocked. |
| **Apprise** | API URL | apprise destination URL | Sidecar bridge to 100+ exotic services. |
| **Browser push** | VAPID subject (keys auto-generated) | captured from the browser | Real system notifications, even when the tab is closed. |

Adding a channel is one file under
`apps/api/utils/channels/<name>.ts` exporting a `ChannelAdapter` —
the admin form, user form, test endpoints, and dispatcher pick it
up from the registry automatically.

## Operator setup

### Required env var

```bash
# Generate with `openssl rand -hex 32`
CHANNEL_ENCRYPTION_KEY=…
```

This key encrypts every channel config at rest (SMTP password,
Telegram token, VAPID private key, …). When unset, the system
falls back to `NUXT_SESSION_SECRET` — fine for a small deployment
but the dedicated var is preferred if you ever want to rotate one
without bouncing user sessions.

### Configuring a channel

1. Open `/admin/notifications`.
2. Pick the channel from the grid. The form is rendered from the
   adapter's `serverFields` declaration — required fields are
   marked, password fields are masked.
3. Save. The server-side test runs automatically (SMTP login, ntfy
   reachability, Telegram `getMe`, …). A green pill means users can
   now opt into that channel.
4. **Send the user-side test** from the same row to confirm the
   round-trip works end to end.

### Browser push (Web Push)

This channel has a couple of quirks worth calling out:

- **VAPID keys auto-generate** on first save. You only fill the
  `subject` field — a `mailto:` or `https://` URL the push services
  (FCM, Mozilla, Apple) can reach you on if abuse is detected. RFC
  8292 requires it.
- The **public key** is exposed to users via the
  `publicServerInfo` route so their browser can pass it to
  `pushManager.subscribe`. The **private key** never leaves the
  API process.
- HTTPS is mandatory — Chrome / Firefox refuse the Push API on
  plain HTTP except for `localhost`. The default Caddy front-end
  already handles this.
- The service worker is served from `/sw.js` with origin scope. No
  build-time configuration needed; it auto-registers when a user
  enables the channel.

If a user's subscription is later revoked (browser cleared, push
service returned `410 Gone`), the circuit breaker disables the
user-channel row after a handful of consecutive failures. The
operator doesn't have to do anything — the user gets a "Subscribe
again" button on their next `/settings` visit.

## User experience

### Enabling a channel

1. `/settings → Notifications`.
2. Click **Add destination**, pick the channel.
3. Fill the user-side fields (email, ntfy topic, …) — for browser
   push, click **Enable in this browser** and accept the permission
   prompt.
4. Hit **Save**, then **Send test** to confirm.

### Routing rules

Every notification type (50+ events: `upload_accepted`,
`comment_on_my_upload`, `hnr_violation_marked`, …) maps to one
channel of the user's choice — or stays in the in-app feed only.
A first-channel onboarding bulk-routes every type to the new
channel; users can later untick or re-route individual rows.

The router is **opt-out** for staff-as-recipient events
(`new_pending_upload`, `new_report_filed`) — those land in the feed
of every active moderator regardless of routing rules, since
missing one is the wrong default for a moderation pipeline.

### Privacy

- All channel configs are **encrypted at rest** with
  `CHANNEL_ENCRYPTION_KEY` / `NUXT_SESSION_SECRET`.
- Secrets (SMTP password, Telegram bot token, webhook HMAC, VAPID
  private key) are **never** re-emitted by the API — the admin UI
  shows `(unchanged — leave blank)` placeholders when editing.
- Rate-limit budgets are enforced per `(user, channel)` so a
  malicious server-side actor can't flood an external service via
  a high-volume event source.

## Reliability

A circuit breaker disables a user-channel row after a configurable
number of consecutive failures so a bad config (typo'd ntfy topic,
revoked Telegram chat) doesn't keep tripping every push. The user
sees a red status pill in `/settings`; one successful test resets
the counter.

Delivery is **fire-and-forget** from the route handler that
emitted the event — the in-app row lands first, then the external
fan-out runs in the background. A slow upstream never blocks an
upload or moderation action.

## Retention

The notification feed has its own retention policy, configurable
from `/admin/settings`:

- `notifications_retention_read_days` — read rows older than this
  are hard-deleted (default 90)
- `notifications_retention_unread_days` — unread rows older than
  this are also hard-deleted (default 90)

The sweeper runs as a Nitro cron plugin
(`apps/api/plugins/notification-retention.ts`) so the policy
applies even on a single-replica deployment.

## Troubleshooting

**No green pill after saving SMTP** — check the server test in
`/admin/notifications`. A red error pops up with the exact upstream
message (auth failed, TLS handshake, …). Username + AUTH PLAIN is
the most common gotcha — Gmail-style App Passwords work; raw
account passwords usually don't.

**Telegram says "Forbidden: bot can't initiate conversation"** —
the user has to send `/start` to the bot once. Telegram blocks bots
from messaging users who haven't opened a conversation first.

**Browser push button stays disabled** — check the `state` line in
the drawer:
- `Permission denied` — re-enable in the site settings of the
  browser.
- `This browser doesn't support Web Push` — Safari < 16.4 on
  macOS, in-app browsers (Twitter / Instagram), or extension-
  sandboxed environments.
- `Administrator hasn't finished setting up Web Push` — go to
  `/admin/notifications`, add the Browser push channel, save it
  once so the VAPID keys are generated.

**A user is missing notifications across the board** — check
`users.isBanned` and the `userNotificationRouting` rows for that
user (the row may have routed everything to a channel that's since
been disabled). Resetting the routing from `/settings` snaps the
user back to the in-app default.
