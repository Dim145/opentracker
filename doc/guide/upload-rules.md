# Upload rules

Trackarr's upload pipeline runs every new `.torrent` through a configurable gate before it reaches the moderation queue. The rules are admin-edited at `/admin/upload-rules` and live in two tables: a singleton (`upload_rules`) for the global toggles, and one row per leaf-category in `upload_rule_category_patterns` for the per-category title regex.

::: tip Upload rules vs Moderation
Upload rules **reject** an upload outright with `400 Bad Request` before the row is created. They're enforced server-side on `POST /api/torrents`. **Moderation** then decides whether a row that *passed* the rules is publishable — see [Moderation](./moderation.md). The two systems are independent.
:::

## Where rules are applied

Every upload goes through `evaluateUpload(snapshot, payload)` in `apps/api/utils/uploadRules.ts`. The check happens *after* the `.torrent` parsing (so the rule has access to size + files) and *before* the row is persisted. A rejection returns an i18n key the FE renders in the user's locale.

The snapshot is **cached in-process with Redis pub/sub invalidation** (same idiom as `utils/settings.ts`):

- TTL: 60 seconds — bounded staleness even if pub/sub goes silent.
- Invalidation: every admin PUT publishes to `upload-rules:invalidate`; every Nitro replica busts its own cache on receipt.

## Available rules

All booleans default to `false` (rule off) except `staffBypass` which defaults to `true`.

### Content rules

| Rule                    | Type    | Effect                                                                                |
| ----------------------- | ------- | ------------------------------------------------------------------------------------- |
| `nfoRequired`           | bool    | Reject when neither a `.nfo` file is attached nor pasted NFO text is provided.        |
| `descriptionRequired`   | bool    | Reject when the description (after trim) is empty.                                    |
| `descriptionMinLength`  | int     | Minimum chars in the description, post-trim. Ignored when `descriptionRequired = false`. `0` = no minimum. |
| `tmdbIdRequired`        | bool    | Reject when no TMDb id is present on the upload, regardless of category.              |

### Size cap

| Rule              | Type        | Effect                                                                                |
| ----------------- | ----------- | ------------------------------------------------------------------------------------- |
| `maxTorrentSize`  | bigint or null | Catastrophe cap, in bytes. Computed against the parsed `.torrent`'s total size (single file or sum of files). `null` = no cap. |

### Title rules

| Rule                    | Type    | Effect                                                                                |
| ----------------------- | ------- | ------------------------------------------------------------------------------------- |
| `titlePatternEnforced`  | bool    | Master switch for per-category regex (below). When off, category patterns are ignored.|
| `titleBlocklist`        | regex   | Global forbidden-words regex applied to every title — typically for banned source qualities (`CAM`, `TS`, `HDCAM`, …). Stored pre-anchored. `null` = no blocklist. |

### Per-category title patterns

Stored in `upload_rule_category_patterns`. One row per leaf-category — intermediate / root categories never hold a pattern.

| Column        | Notes                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| `categoryId`  | FK → `categories.id`, primary key, `ON DELETE CASCADE`. Removing a category auto-cleans the rule. |
| `pattern`     | Already wrapped with `^…$` at save time. Runtime check is `new RegExp(pattern, 'i').test(title)`. |

Patterns are inherited from ancestors: a child without its own pattern inherits the nearest ancestor's. A child's own pattern overrides every ancestor. The walk is resolved once at cache-miss time, so the runtime enforcer just does a single lookup.

Example: a `Movies/4K` category inherits the pattern from `Movies` unless `Movies/4K` carries its own.

### Staff bypass

| Rule          | Type | Effect                                                                                              |
| ------------- | ---- | --------------------------------------------------------------------------------------------------- |
| `staffBypass` | bool | When `true`, users with `isAdmin` or `isModerator` skip every rule above. Default `true`.           |

::: tip Staff bypass vs role bypass
`staffBypass` skips the **upload-rule checks**. The role flag `canUploadWithoutModeration` skips the **moderation queue**. The two are independent — a power-user role can be configured to bypass moderation but still be subject to the rules.
:::

## UI

### `/admin/upload-rules`

A single form, save-on-submit. Each toggle has a hint explaining its effect. The per-category pattern editor renders the category tree and shows, for each leaf:

1. Its own pattern (editable).
2. The inherited pattern (read-only, with the ancestor name).
3. The effective pattern (computed on save, also read-only).

This visualises the inheritance walk so admins can debug "why is my new category rejecting everything?" without guessing.

### `/torrents/upload`

Client-side, the form fetches `GET /api/upload-rules` and uses the response to:

- Render the NFO + description requirements with the right asterisks.
- Hide the TMDb id input only when the category doesn't need it AND `tmdbIdRequired = false`.
- Cap the file picker at `maxTorrentSize`.
- Live-validate the title against the effective category pattern (with the cyan "✓ matches" hint).

The client mirror is informational — the **server-side enforcement is authoritative** and always re-runs on `POST /api/torrents`.

## Error codes

`evaluateUpload` returns one of the following i18n keys when it rejects:

| Key                                 | Meaning                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `upload.rules.nfo_required`         | NFO required, none provided.                                         |
| `upload.rules.description_required` | Description required, empty after trim.                              |
| `upload.rules.description_too_short`| Description shorter than `descriptionMinLength`.                     |
| `upload.rules.title_pattern`        | Title fails the effective category regex.                            |
| `upload.rules.title_blocklist`      | Title matches the global blocklist.                                  |
| `upload.rules.tmdb_required`        | No TMDb id supplied.                                                 |
| `upload.rules.size_too_large`       | Parsed total size exceeds `maxTorrentSize`.                          |

The HTTP response is always `400 Bad Request` with the key in `message`.

## API surface

| Method | Path                              | Auth   | Notes                                                                  |
| ------ | --------------------------------- | ------ | ---------------------------------------------------------------------- |
| GET    | `/api/upload-rules`               | public | Public snapshot — drives the client-side upload form.                  |
| GET    | `/api/admin/upload-rules`         | admin  | Same snapshot + private fields (none today, but reserved for growth).  |
| PUT    | `/api/admin/upload-rules`         | admin  | Replace the singleton + per-category patterns atomically. Publishes the invalidation message. |

## Implementation reference

| Concern                              | File                                                              |
| ------------------------------------ | ----------------------------------------------------------------- |
| Schema                               | `packages/db/src/schema.ts` (`upload_rules`, `upload_rule_category_patterns`) |
| Loader / cache / Redis invalidation  | `apps/api/utils/uploadRules.ts`                                   |
| Server-side enforcer (`evaluateUpload`) | same file                                                       |
| Admin form                           | `apps/web/app/pages/admin/upload-rules.vue`                       |
| Upload form (client mirror)          | `apps/web/app/pages/torrents/upload.vue`                          |
| Public reader                        | `apps/api/routes/api/upload-rules.get.ts`                         |
| Admin endpoints                      | `apps/api/routes/api/admin/upload-rules/*`                        |
