# Hit-and-Run (HnR)

A *hit-and-run* is a user who downloads a torrent and stops seeding before the operator-defined seed-time threshold. Trackarr enforces HnR at the per-(user, torrent) level so the consequences land on the responsible account, not the operator's mood.

## Concepts

| Term                | Meaning                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| **Required seed time** | How long (seconds) a user must seed a given torrent before HnR is cleared. Default `86400` (24 h). Operator-configurable from `/admin/settings`. |
| **Grace period**    | Window after `downloadedAt` during which a not-yet-completed download is *not* flagged. Configurable in `/admin/settings`. |
| **Completed**       | A row reached `seedTime >= requiredSeedTime`. `completedAt` is set; `isHnr` is forced to `false` and never re-flips. |
| **Exempt**          | Moderator manually waives the requirement. Engine ignores the row from that point onward.         |
| **Flagged (`isHnr = true`)** | The grace period expired, the user still hadn't met the requirement. Auto-clearable by completing or by moderator action. |

## Data model — `hnr_tracking`

One row per (user, torrent). The unique index `hnr_user_torrent_idx` guarantees idempotency.

| Column            | Notes                                                                |
| ----------------- | -------------------------------------------------------------------- |
| `userId`          | FK → `users` (cascade delete).                                       |
| `torrentId`       | FK → `torrents` (cascade delete).                                    |
| `downloadedAt`    | When the user first either clicked Download or completed the torrent.|
| `seedTime`        | Accumulated seconds seeded (incremented by the tracker on every announce). |
| `requiredSeedTime`| Snapshot of the threshold at insert time. Lets the operator change the global default without retroactively re-graded existing rows. |
| `isHnr`           | `true` once the grace window expired without completion.             |
| `isExempt`        | Manual moderator waiver.                                             |
| `completedAt`     | Set when `seedTime >= requiredSeedTime`. Final state for that row.   |
| `uploaded`, `downloaded` | Per-(user, torrent) byte counters maintained by the tracker. Drives the `/downloads` history page. |

## Lifecycle

```
                     POST /api/torrents/:hash/download
                                  │
                                  ▼
                          recordDownloadClick()
                          (ON CONFLICT DO NOTHING)
                                  │
                                  ▼
                       ┌─────────────────────────┐
                       │ row inserted            │
                       │  isHnr     = false      │
                       │  completedAt = null     │
                       └────────────┬────────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
                ▼                   ▼                   ▼
   tracker announce         grace expired,       moderator action
   updates seedTime         not yet completed     `exempt` / `clear`
                │                   │                   │
                ▼                   ▼                   ▼
        seedTime ≥ required?   checkAndMarkHnrs    isExempt = true
                │              flips isHnr=true    OR isHnr=false
                ▼              + notify             + completedAt=now
        completedAt = now
        isHnr = false (final)
```

## Where the seed-time delta comes from

The Go tracker's announce handler diffs `uploaded` / `downloaded` against the previous peer entry on every announce and persists them into `hnr_tracking` in the same transaction it updates `users.uploaded` / `users.downloaded`. A separate ticker calls `updateSeedTime(user, torrent, secondsSeeded)` to bump `seedTime`. Exempt or completed rows short-circuit early so no further state churn happens on them.

The previous-announce snapshot lives in Redis with a **24 h TTL by default**, configurable via `TRACKER_PEER_TTL` (Go duration string — `24h`, `90m`, `7200s`; values below `15m` are clamped to that floor). Two cases used to silently zero the delta:

- **First announce ever** for a given (peer_id, info_hash) pair — Redis has no `prev`, so a naive diff produced `0`.
- **Gap longer than the TTL** — same effect, the peer hash expired between announces.

To recover those bytes, when the very first announce for a peer carries `event=started`, the tracker trusts the client's declared cumulative `uploaded` / `downloaded` as the initial delta. That covers honest clients that resume a session or rejoin after sleep without losing what they already pushed. The existing 1 TiB/announce cap bounds the worst-case spoofing window, and a `started` announce is still rate-limited like any other.

## When rows get flagged

`checkAndMarkHnrs()` runs from the API plugin loop. On each pass:

1. It reads the current grace period from `/admin/settings` (`getHnrGracePeriod`).
2. It selects every row where `isHnr = false`, `isExempt = false`, `completedAt IS NULL`, and `downloadedAt < now - graceWindow`.
3. It flips those rows to `isHnr = true` in a single `UPDATE … RETURNING`.
4. For each flipped row it fans out a `hnr_violation_marked` notification to the user (resolving the torrent name so the inbox row is meaningful).

This means the user is *always* notified the moment they cross the line — they don't have to discover the flag by checking their profile.

## What gets flagged user-visibly

| Surface              | Notes                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| **`/downloads`**     | Personal history of every torrent the user clicked Download on. HnR rows are colour-rail flagged with a countdown ("⏳ 4h 12m remaining" before grace expiry) or the active flag once expired. |
| **`/me`**            | Hero KPI strip carries the user's current HnR count.                                               |
| **`/users/[id]`**    | Public profile shows the same KPI to other members.                                                |
| **`/mod/hnr`**       | Moderator queue (filterable by status: open / completed / exempt).                                 |
| **Notification**     | `hnr_violation_marked` → goes through the user's notification routing.                             |

## Moderator actions

The queue at `/mod/hnr` exposes two actions per row:

| Action  | Effect                                                                                              |
| ------- | --------------------------------------------------------------------------------------------------- |
| Exempt  | Sets `isExempt = true`. Future seed-time updates skip the row; the flag never re-fires.            |
| Clear   | Sets `isHnr = false` and `completedAt = now`, the same final state a legitimate completion reaches. Use this for one-off forgiveness. |

Both end up in `hnr_user_is_hnr_idx`-indexed queries the same way — the audit columns (`completedAt`, `isExempt`) tell the two paths apart.

## Auto-role interactions

`roleRules.ts` exposes `hnrCount` (current `isHnr = true` rows) and `completedSeeds` (rows with `completedAt IS NOT NULL`) as auto-assignment fields. Common patterns:

- **"Member" → "Power User"** when `completedSeeds ≥ 50` AND `hnrCount = 0`.
- **"Member" → "Probation"** when `hnrCount ≥ 3`.

When a moderator exempts or clears a flag, the affected user's roles are **not** auto-recomputed by the action itself — admins can trigger a sweep from `/admin/roles` (`POST /api/admin/roles/recompute`).

See [Roles & Permissions](./roles-and-permissions.md).

## Disabling HnR

Set the feature flag to off in `/admin/settings`:

- New downloads stop inserting `hnr_tracking` rows via `createHnrEntry()`.
- Existing rows are kept, but `checkAndMarkHnrs()` becomes a no-op (returns 0 immediately).
- The `recordDownloadClick()` path still records a row, because the Downloads page is a personal log — it shouldn't vanish when the operator switches enforcement off.

## Bonus interactions

The seed-bonus accumulator reads `seedTime` from the same table to credit `seeding_milestone` grants (24 h / 1 week / 30 d thresholds). HnR enforcement and bonus crediting share their `seedTime` source-of-truth — there's no risk of "rewarded for seeding but still flagged" inconsistencies.

See [Seed Bonus](./seed-bonus.md).

## API surface

| Method | Path                          | Auth | Notes                                                                  |
| ------ | ----------------------------- | ---- | ---------------------------------------------------------------------- |
| GET    | `/api/users/hnr`              | user | Current user's flagged rows (used by the bell badge fallback).         |
| GET    | `/api/admin/hnr`              | mod  | Queue. Filters: `status=open|completed|all`.                           |
| PUT    | `/api/admin/hnr/:id`          | mod  | Body: `{ action: 'exempt' | 'clear' }`.                                |
| GET    | `/api/me/downloads`           | user | Per-torrent history with HnR state inline.                             |

## Implementation reference

| Concern                                  | File                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Schema                                   | `packages/db/src/schema.ts` (`hnr_tracking`)                      |
| HnR logic (insert / update / mark)       | `apps/api/utils/hnr.ts`                                           |
| Tracker-side delta updates               | `apps/tracker/internal/server/handler.go` (announce path)         |
| Mark-as-HnR sweeper                      | called from the API plugin loop (`checkAndMarkHnrs`)              |
| Moderator queue                          | `apps/api/routes/api/admin/hnr/*`, `apps/web/app/pages/mod/hnr.vue` |
| User downloads page                      | `apps/web/app/pages/downloads.vue`                                |
