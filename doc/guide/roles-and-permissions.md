# Roles & permissions

Trackarr uses a many-to-many role model. A user can hold several roles at once — typically one auto-assigned by the engine plus zero or more manually attached by an admin. Roles drive both **permission grants** (e.g. "bypass moderation") and **visual badges** on the public profile.

## Schema

```
users ─┐
       │ many-to-many via user_roles
roles ─┘
```

### `roles`

| Column                       | Notes                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `name`                       | Unique. Surfaces as the badge label and in moderation logs.                          |
| `color`                      | Hex string (e.g. `#9ca3af`). Drives the badge tint.                                  |
| `icon`                       | Phosphor icon id (e.g. `ph:shield-check`). Optional; falls back to a tag glyph.       |
| `showAsBadge`                | When `true`, the role is rendered as a public chip on the profile.                   |
| `priority`                   | Higher first. Drives badge ordering **and** permission resolution.                   |
| `assignmentMode`             | `'manual'` or `'auto'`. Auto roles are owned by the engine — see below.              |
| `rules`                      | `jsonb` rule tree consumed by the auto-engine. `null` or empty = no match (safety).  |
| `canUploadWithoutModeration` | If `true`, uploads from anyone carrying the role land directly as `accepted`.        |

### `user_roles` (junction)

Composite primary key `(userId, roleId)`. Carries two relationship fields:

| Column            | Notes                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `assignedAt`      | When the role landed (engine sweep or admin attach). Shown in the profile chip tooltip.  |
| `assignedManually` | `true` for admin-attached rows. The engine **never deletes** these, even when the user no longer matches the rules. |

## Permission resolution

Permissions are the **union** of every attached role's grants. The flag set in code is small today:

| Flag                          | Effect                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `canUploadWithoutModeration`  | Upload bypasses the moderation queue, the row lands as `accepted`.                    |

`isAdmin` and `isModerator` live on `users` directly (not on roles). They drive `/admin` and `/mod` access respectively, and they short-circuit a few rules (notably `staffBypass` on [Upload Rules](./upload-rules.md)).

## Auto-assignment engine

Auto roles are evaluated by `apps/api/utils/roleRules.ts`. The engine runs in three places:

1. **`POST /api/admin/roles/recompute`** — full fleet sweep, attaches/detaches across every user.
2. **`reevaluateUserRole(userId)`** — single-user recompute, called automatically after upload approvals, rejections, reports, and HnR transitions.
3. **Cron plugin** — `role-evaluator.ts` runs periodically to catch users whose stats changed silently (e.g. seed-time accumulating).

The engine **inserts** matching auto rows that don't already exist and **deletes** auto rows where the user no longer matches. Manual rows are never touched.

### Rule tree shape

```json
{
  "combinator": "and",
  "conditions": [
    { "field": "ratio",         "comparator": "gte", "value": 1.0 },
    { "field": "approvedUploads","comparator": "gte", "value": 5 },
    { "field": "hnrCount",      "comparator": "eq",  "value": 0 }
  ]
}
```

| Field             | Driven by                                                              |
| ----------------- | ---------------------------------------------------------------------- |
| `approvedUploads` | `count(torrents WHERE moderation_status='accepted' AND uploader=user)` |
| `totalUploads`    | `count(torrents WHERE uploader=user)`                                  |
| `ratio`           | `users.uploaded / users.downloaded` (`+Inf` when `downloaded = 0`).    |
| `uploadedBytes`   | `users.uploaded`.                                                      |
| `downloadedBytes` | `users.downloaded`.                                                    |
| `accountAgeDays`  | `floor((now - users.createdAt) / 1 day)`.                              |
| `hnrCount`        | `count(hnr_tracking WHERE isHnr=true AND user=user)`.                  |
| `completedSeeds`  | `count(hnr_tracking WHERE completedAt IS NOT NULL AND user=user)`.     |

| Comparator | Meaning            |
| ---------- | ------------------ |
| `gte`      | `≥`                |
| `gt`       | `>`                |
| `lte`      | `≤`                |
| `lt`       | `<`                |
| `eq`       | `==`               |

| Combinator | Meaning                                                          |
| ---------- | ---------------------------------------------------------------- |
| `and`      | Every condition must be true.                                    |
| `or`       | Any condition must be true.                                      |

::: warning Empty rules don't match
A rule tree with no conditions is treated as **no match**, so an auto role that was created without configured rules doesn't accidentally win every comparison.
:::

### Example: "Power User"

```json
{
  "name": "Power User",
  "color": "#22c55e",
  "icon": "ph:lightning-bold",
  "showAsBadge": true,
  "priority": 50,
  "assignmentMode": "auto",
  "canUploadWithoutModeration": false,
  "rules": {
    "combinator": "and",
    "conditions": [
      { "field": "completedSeeds", "comparator": "gte", "value": 50 },
      { "field": "ratio",          "comparator": "gte", "value": 1.5 },
      { "field": "hnrCount",       "comparator": "eq",  "value": 0 }
    ]
  }
}
```

### Example: "Uploader" (bypass moderation)

```json
{
  "name": "Uploader",
  "color": "#0ea5e9",
  "icon": "ph:cloud-arrow-up-bold",
  "showAsBadge": true,
  "priority": 75,
  "assignmentMode": "auto",
  "canUploadWithoutModeration": true,
  "rules": {
    "combinator": "and",
    "conditions": [
      { "field": "approvedUploads", "comparator": "gte", "value": 25 }
    ]
  }
}
```

A user holding this role uploads bypass the [Moderation queue](./moderation.md) entirely. The flag is cached in Redis for 5 minutes; the cache is invalidated automatically when the role membership or the role flag itself changes.

## Manual vs auto

| Aspect              | Manual                                              | Auto                                                                  |
| ------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| Attached by         | Admin from `/admin/users` (or role manage dialog).  | Engine on `recompute` / user-event hook / cron.                       |
| `assignedManually`  | `true`                                              | `false`                                                               |
| Engine deletes?     | **Never** — manual is a freeze against the engine. | Yes, when the user no longer matches.                                 |
| Use case            | Custom labels, contributors, sponsors, probation.   | Automatic tiering ("Member" → "Power User" → "VIP").                  |

Mixing both is safe: a user can be auto-attached to "Power User" *and* manually attached to "Sponsor" at the same time.

## UI

### Profile chips

The `/users/:id` and `/me` pages render every role with `showAsBadge = true`, sorted by `priority` descending. The chip carries the role colour + icon and shows a tooltip with `assignedAt` + (auto vs manual).

### Admin views

| Page             | Purpose                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------- |
| `/admin/roles`   | CRUD on the role catalogue + rule editor + bulk recompute button.                             |
| `/admin/users`   | Per-user role attach/detach dialog. Manual attaches are marked as "freeze the engine".        |

## API surface

| Method | Path                                          | Auth  | Notes                                                                  |
| ------ | --------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| GET    | `/api/admin/roles`                            | admin | List with attached-user counts.                                        |
| POST   | `/api/admin/roles`                            | admin | Create.                                                                |
| PUT    | `/api/admin/roles/:id`                        | admin | Edit (name, color, rules, permissions).                                |
| DELETE | `/api/admin/roles/:id`                        | admin | Remove (cascades the junction rows).                                   |
| POST   | `/api/admin/roles/recompute`                  | admin | Sweep every user against every auto rule.                              |
| GET    | `/api/admin/users/:id/roles`                  | admin | List a user's attached roles.                                          |
| POST   | `/api/admin/users/:id/roles`                  | admin | Manual attach. Sets `assignedManually = true`.                         |
| DELETE | `/api/admin/users/:id/roles/:roleId`          | admin | Detach. Engine may re-attach on its next sweep if the rules still match.|

::: tip Compatibility shim
`PUT /api/admin/users/:id/role` is the legacy single-role endpoint and remains for older admin UIs. New code should use the `/roles` collection above.
:::

## Caveats & gotchas

- **`+Inf` ratio**: a user with `downloaded = 0` and `uploaded > 0` has ratio `+Infinity`. The rule evaluator compares as numbers, so `ratio gte 999999` matches them. If your intent is "demonstrated activity", combine with `downloadedBytes gte X`.
- **`completedSeeds` vs `seedTime`**: the field counts *rows that reached completion at any point*, not currently-seeded torrents. Don't use it as a "currently seeding" proxy.
- **Recompute on big fleets**: the sweep is `O(users × rules)` with cheap indexed counts per user. Tens of thousands of users finish in seconds.

## Implementation reference

| Concern                                  | File                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Schema                                   | `packages/db/src/schema.ts` (`roles`, `user_roles`)               |
| Rule engine                              | `apps/api/utils/roleRules.ts`                                     |
| Stats aggregation per user               | `computeUserStats()` in the same file                             |
| Cron sweep                               | `apps/api/plugins/role-evaluator.ts`                              |
| Admin CRUD routes                        | `apps/api/routes/api/admin/roles/*`, `users/[id]/roles/*`         |
| Web admin pages                          | `apps/web/app/pages/admin/roles.vue`, `users.vue`                 |
