# Forum

Trackarr ships an in-app forum so a private community can organise outside the torrent listings. It sits at `/forum`, with three tables on the database side and a thin permission model layered on top.

## Data model

```
forum_categories  ──┐
                    │ has many
forum_topics ───────┤
                    │ has many
forum_posts        ─┘
```

| Table              | Notes                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `forum_categories` | Operator-curated structure. Each row has a name, optional description, optional Phosphor `icon`, optional hex `color`, and an `order` integer for sidebar sorting. |
| `forum_topics`     | One row per thread. Carries `isPinned` + `isLocked` booleans. `authorId` is `ON DELETE SET NULL` — when a user is deleted their threads remain (rendered as "[deleted]"). |
| `forum_posts`      | Replies to a topic. Same `authorId` deletion semantics as topics.                                  |

::: tip Why "[deleted]" instead of cascade?
Cascading from `users` to `forum_topics`/`forum_posts` would have blocked every user-deletion request behind the FK. With `SET NULL` we can purge a spam account without losing the rest of the discussion — the contributions stay, only the byline disappears.
:::

## Permission matrix

| Surface                       | Anonymous | User      | Author of the row | Mod/Admin |
| ----------------------------- | --------- | --------- | ----------------- | --------- |
| Browse categories + topics    | ✅        | ✅        | ✅                | ✅        |
| Read a topic                  | ✅        | ✅        | ✅                | ✅        |
| Create a topic                | ❌        | ✅¹       | —                 | ✅        |
| Reply to a topic              | ❌        | ✅¹       | —                 | ✅        |
| Edit a topic / post           | ❌        | ❌        | ✅                | ✅        |
| Delete a topic / post         | ❌        | ❌        | ✅                | ✅        |
| Pin / Unpin                   | ❌        | ❌        | ❌                | ✅        |
| Lock / Unlock                 | ❌        | ❌        | ❌                | ✅        |
| Create / Edit / Delete a category | ❌    | ❌        | ❌                | ✅ (admin only) |

¹ Members cannot post in a topic that is `isLocked = true`. Mods/admins ignore the lock.

## UI

### `/forum` — index

A sidebar lists every category sorted by `order ASC`. Each category has its own colour rail and Phosphor icon when configured, otherwise the UI falls back to neutral chrome. The main pane shows the most recent topics across all categories.

### `/forum/category/[id]` — category page

Topics are sorted: **pinned first** (by most-recently-updated), then everything else by most-recently-updated. Each row shows the title, author, reply count, and the relative time of the last reply.

### `/forum/topic/[id]` — topic page

A pinned banner appears for `isPinned`, a lock icon for `isLocked`. The composer is hidden when locked unless the viewer is staff. Authors get an inline edit/delete pencil on their own posts; staff get it on every post.

### `/forum/new-topic` — creation form

Pre-fills the category from the `?category=` query param when present (e.g. the "New topic" button on a category page).

## Lifecycle

```
                       POST /api/forum/topics
                              │
                              ▼
                      ┌─────────────────┐
                      │  fresh topic    │
                      └───────┬─────────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
       │ POST /api/forum/posts (members + staff)
       │                      │                      │
       ▼                      ▼                      ▼
  ┌─────────┐          ┌───────────┐          ┌──────────┐
  │ replies │          │ mod pins  │          │ mod locks│
  │ accrue  │          │ /pin      │          │ /lock    │
  └─────────┘          └───────────┘          └──────────┘
                              │
                              ▼
                    DELETE by author or mod
                    cascades to every post
                    (FK `ON DELETE CASCADE`)
```

## API surface

| Method | Path                                       | Auth        | Notes                                                  |
| ------ | ------------------------------------------ | ----------- | ------------------------------------------------------ |
| GET    | `/api/forum/categories`                    | public      | Index.                                                 |
| GET    | `/api/forum/categories/:id`                | public      | Category detail + paginated topics.                    |
| POST   | `/api/forum/categories`                    | admin       | Create.                                                |
| PUT    | `/api/forum/categories/:id`                | admin       | Edit.                                                  |
| DELETE | `/api/forum/categories/:id`                | admin       | Remove (cascades to topics + posts).                   |
| POST   | `/api/forum/topics`                        | user        | Create. Required: `{ categoryId, title, content }`.    |
| GET    | `/api/forum/topics/:id`                    | public      | Topic + paginated posts.                               |
| DELETE | `/api/forum/topics/:id`                    | author/mod  | Remove.                                                |
| PUT    | `/api/forum/topics/:id/pin`                | mod         | Toggle pin.                                            |
| PUT    | `/api/forum/topics/:id/lock`               | mod         | Toggle lock.                                           |
| POST   | `/api/forum/posts`                         | user        | Reply. Required: `{ topicId, content }`.               |
| PATCH  | `/api/forum/posts/:id`                     | author/mod  | Edit.                                                  |
| DELETE | `/api/forum/posts/:id`                     | author/mod  | Delete.                                                |
| GET    | `/api/forum/stats`                         | public      | Aggregates (topic count, post count, latest reply).    |

## Notifications

Forum activity routes through the standard notification pipeline (see [Notifications](./notifications.md)). The events surfaced today are:

- **`new_report_filed`** — when a forum post is reported, every staff member gets a notification (this is the generic report fan-out, not forum-specific).
- **`report_actioned`** — when a moderator dismisses or resolves a report on the user's post.

The forum doesn't emit "someone replied to your thread" notifications today — that's on the roadmap.

## Reporting

Forum posts are one of the four target types in [Reports](./moderation.md#reports) (`target_type = 'post'`). A resolved report on a `post` target does **not** cascade to a delete — moderators still need to pull the trigger manually from the post's edit/delete affordance. This is deliberate: a single report shouldn't be enough to nuke a discussion entry.

## Implementation reference

| Concern                                  | File                                                              |
| ---------------------------------------- | ----------------------------------------------------------------- |
| Schema (categories / topics / posts)     | `packages/db/src/schema.ts`                                       |
| Public category + topic reads            | `apps/api/routes/api/forum/categories/*`, `topics/*`              |
| Topic + post creation                    | `apps/api/routes/api/forum/topics/index.post.ts`, `posts/index.post.ts` |
| Pin / lock toggles                       | `apps/api/routes/api/forum/topics/[id]/pin.put.ts`, `lock.put.ts` |
| Web pages                                | `apps/web/app/pages/forum/*`                                      |
