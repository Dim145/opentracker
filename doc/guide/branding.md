# Branding & site settings

Trackarr's visible identity — title, logo, subtitle, hero copy, login pages, footer, the homepage banner — is **entirely runtime-driven**. There are no env vars to set; the first admin edits everything live from `/admin/branding` and `/admin/settings`. New values land in the `settings` key-value table and are served back through `/api/branding` to every visitor.

## How it works

```
       ┌─────────────────────────┐
       │  /admin/branding form   │
       │  /admin/settings form   │
       └────────────┬────────────┘
                    │ PUT /api/admin/settings
                    │ POST /api/admin/logo
                    │ POST /api/admin/favicon
                    ▼
       ┌─────────────────────────┐
       │  settings (key/value)   │
       │  uploads/ (logo, favicon)│
       └────────────┬────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        ▼                       ▼
  ┌──────────┐           ┌──────────────┐
  │ Redis    │  pub/sub  │  GET /api/   │
  │ invalidate            │  branding    │
  │ channel  │           │  (cached)    │
  └────┬─────┘           └──────────────┘
       │
       ▼
  every Nitro replica clears its local 60 s cache so the new value lands within one request
```

The cache uses the same idiom as [Upload Rules](./upload-rules.md): in-process 60 s TTL + Redis pub/sub invalidation on every write.

## What lives in `settings`

Each row is a free-form `(key, value)` pair (both `text`). The keys are enumerated in `apps/api/utils/settings.ts` (`SETTINGS_KEYS`).

### Identity

| Key                 | Effect                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `site_name`         | Display name. Renders in the header, title tag, footer, and notification subjects.        |
| `site_subtitle`     | Optional tagline shown below the name.                                                    |
| `site_name_color`   | Optional hex color override for the name in the header.                                   |
| `site_name_bold`    | `true`/`false`. Wraps the name in `<strong>` when true.                                   |
| `site_logo`         | Emoji or short text shown when no image logo is uploaded.                                 |
| `site_logo_image`   | Path to the uploaded logo (set by `POST /api/admin/logo`). Empty = fall back to `site_logo`. |
| `site_favicon`      | Path to the uploaded favicon (`POST /api/admin/favicon`).                                 |
| `page_title_suffix` | Suffix appended to every page title (e.g. `· My Tracker`).                                |

### Auth pages

| Key             | Effect                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| `auth_title`    | Override the headline on `/auth/login` and `/auth/register`.            |
| `auth_subtitle` | Override the subheading on the auth pages.                              |

### Homepage

| Key                 | Effect                                                              |
| ------------------- | ------------------------------------------------------------------- |
| `hero_title`        | Big headline on `/`.                                                |
| `hero_subtitle`     | Subheading.                                                         |
| `status_badge_text` | The pill text next to the hero (e.g. "Beta", "Invite-only").       |
| `feature_1_title`   | Card 1 title under the hero.                                        |
| `feature_1_desc`    | Card 1 description.                                                 |
| `feature_2_*`       | Card 2.                                                             |
| `feature_3_*`       | Card 3.                                                             |
| `welcome_message`   | Markdown shown in a dismissible welcome banner after first login.   |

### Footer

| Key           | Effect                          |
| ------------- | ------------------------------- |
| `footer_text` | Markdown rendered in the footer.|

### Site rules

| Key          | Effect                                                                            |
| ------------ | --------------------------------------------------------------------------------- |
| `site_rules` | Markdown. Surfaces on the registration page and in the user's dropdown menu.      |

### Announcement banner

A site-wide banner shown at the top of every page until an admin disables it.

| Key                     | Effect                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `announcement_enabled`  | `true`/`false` master toggle.                                                       |
| `announcement_message`  | Markdown body.                                                                      |
| `announcement_type`     | `info` / `warning` / `success` / `error`. Drives the colour rail.                   |

### Operational toggles

These aren't visual but live on the same page (`/admin/settings`):

| Key                                | Effect                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `registration_open`                | `true`/`false`. When `false`, `/auth/register` is gated behind an invite code. |
| `invite_enabled`                   | Master switch for the invite system.                                    |
| `default_invites`                  | How many invite slots a fresh account starts with.                      |
| `min_ratio`                        | Floor enforced on user ratio. Used by the bonus economy + warnings.     |
| `starter_upload`                   | Bytes credited to `users.uploaded` + `users.bonusUploaded` at registration. |
| `hnr_enabled`                      | Master switch for [Hit-and-Run](./hit-and-run.md) enforcement.          |
| `hnr_required_seed_time`           | Seconds. Default `86400` (24 h).                                        |
| `hnr_grace_period`                 | Seconds. Window before a not-yet-completed download is flagged.         |
| `require_2fa_scope`                | `off` / `staff` / `all`. See [Two-Factor Auth](./two-factor-auth.md).   |
| `notifications_retention_read_days`   | TTL (days) for read notifications. Drives the `notification-retention` cron. |
| `notifications_retention_unread_days` | TTL (days) for unread notifications.                                |

## File uploads

The logo and favicon are real files, not URLs. They're stored under `${UPLOADS_DIR}/branding/` (defaults to `./data/uploads/branding/` inside the API container) and served via `GET /uploads/branding/...`.

| Endpoint                     | Method | Notes                                                                  |
| ---------------------------- | ------ | ---------------------------------------------------------------------- |
| `POST /api/admin/logo`       | POST   | Multipart upload, single field `file`. Server validates MIME + caps size.|
| `POST /api/admin/favicon`    | POST   | Same shape.                                                            |

The endpoints overwrite the previous file (one logo + one favicon active at a time) and set the matching `site_logo_image` / `site_favicon` setting in the same transaction.

## SSR-friendly delivery

`/api/branding` is the **public** read endpoint — no auth required. Nuxt SSR fetches it once on first paint, hydrates the result into the `useBranding()` composable, and the static-SPA build picks it up via `/api/runtime-config`. This means a single Trackarr image is fully portable across operators: someone redeploying for their own community only needs to edit `/admin/branding` to make the site theirs.

## API surface

| Method | Path                              | Auth   | Notes                                                                  |
| ------ | --------------------------------- | ------ | ---------------------------------------------------------------------- |
| GET    | `/api/branding`                   | public | All visible identity fields in one call.                               |
| GET    | `/api/homepage-content`           | public | Hero + feature cards (`hero_*`, `feature_*_*` settings).               |
| GET    | `/api/announcement`               | public | `{ enabled, message, type }`. Empty `message` if disabled.             |
| GET    | `/api/admin/settings`             | admin  | Full settings table (every key including hidden ones).                 |
| PUT    | `/api/admin/settings`             | admin  | Update one or more settings atomically.                                |
| POST   | `/api/admin/logo`                 | admin  | Upload logo (multipart).                                               |
| POST   | `/api/admin/favicon`              | admin  | Upload favicon (multipart).                                            |

## Caveats & gotchas

- **First-boot defaults**: `registration_open` defaults to `false` (opt-in registration), `staffBypass` defaults to `true`. The first admin should sweep `/admin/settings` once after install.
- **Cache staleness on rollback**: if you roll back a setting by editing `settings` directly in the DB (e.g. a recovery action), publish a manual invalidation: `redis-cli PUBLISH settings:invalidate <key>`. Without it, every Nitro replica keeps the stale value until the 60 s TTL expires.
- **Markdown surfaces**: `site_rules`, `footer_text`, `welcome_message`, `announcement_message` are all rendered as Markdown. Sanitisation happens on the client; don't paste raw HTML you wouldn't trust.

## Implementation reference

| Concern                              | File                                                              |
| ------------------------------------ | ----------------------------------------------------------------- |
| Schema                               | `packages/db/src/schema.ts` (`settings`)                          |
| Key registry + cached getters        | `apps/api/utils/settings.ts`                                      |
| Public branding endpoint             | `apps/api/routes/api/branding.get.ts`                             |
| Admin settings PUT                   | `apps/api/routes/api/admin/settings.put.ts`                       |
| Logo / favicon upload                | `apps/api/routes/api/admin/logo.post.ts`, `favicon.post.ts`       |
| Web admin form                       | `apps/web/app/pages/admin/branding.vue`, `settings.vue`           |
| Public branding composable           | `apps/web/app/composables/useBranding.ts`                         |
