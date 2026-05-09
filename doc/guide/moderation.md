# Torrent moderation

Every uploaded torrent travels through a four-state moderation pipeline. The state lives on `torrents.moderation_status`:

| State                | Visible to                  | Editable by                  | Notes                                                                                     |
| -------------------- | --------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| `pending`            | uploader + staff            | uploader (free), staff (any) | Default state for any non-bypass upload. Hidden from public listings.                     |
| `accepted`           | everyone                    | uploader, staff              | Public. A non-bypass edit by the uploader auto-reverts the row to `pending`.              |
| `changes_requested`  | uploader + staff            | uploader (free), staff       | A moderator asked for edits. Saving an edit auto-resubmits → `pending`.                   |
| `rejected`           | uploader + staff            | **frozen** for everyone      | Only `/api/mod/torrents/:hash/reset` can move the row out. Re-uploading the same hash is blocked. |

## Bypass

Staff (admin / moderator) and members carrying any role with `canUploadWithoutModeration: true` skip the queue entirely — their uploads land directly as `accepted`. The flag is consulted on every upload + edit through `userCanBypassModeration()` (Redis-cached for 5 minutes; the cache is invalidated when role membership or the role flag itself changes).

## The discussion thread

Every status change emits a row in `torrent_moderation_messages`. The same table also accepts free-form chat posts from either the uploader or staff — useful for clarification questions before a moderator commits to a status change.

Visibility:

- The uploader of the torrent (read/write on their own torrent's thread).
- Any moderator/admin (read/write on every thread).

Anyone else gets a flat `404` on the thread endpoint — same response as a non-existent hash, so a probe can't even confirm a thread exists.

## UI surface

### Torrent detail page

The badge row above the title carries the current status (`PENDING REVIEW`, `CHANGES REQUESTED`, `REJECTED`). The badge is hidden once the row is `accepted`.

Below the swarm card, a collapsible "File · Moderation" panel shows the conversation thread. The banner is colour-coded per status (amber / sky / red), opens on click, and exposes a composer + the action buttons relevant to the current state:

- **Approve** — moves to `accepted`. Optional message.
- **Request changes** — moves to `changes_requested`. **Note required** (the user has to know what to change).
- **Reject** — moves to `rejected`. **Reason required** (transparency).
- **Re-open to pending** — only visible from `rejected`. Note required.

Members see the same panel but only the *Send reply* button — no status change actions.

When a torrent is in a non-final state (`pending` or `changes_requested`) the panel renders **at the top of the page** instead of the bottom, so the uploader sees the moderator's instructions without scrolling past every byte of metadata.

### Admin queue (`/mod/pending`)

The queue lists every row whose status isn't `accepted`. A segmented filter (All / Pending / Changes / Rejected) splits the buckets, each with its own colour rail. Clicking a row opens its detail page where the panel takes over.

Staff don't act from the queue itself — every status change is tied to a moderator note that lives on the torrent page, not in a one-shot action button. This keeps the audit trail in one place.

## Re-upload of a rejected info-hash

The `torrents.info_hash` column is `UNIQUE`. A rejected row is therefore impossible to re-insert. The upload endpoint (`POST /api/torrents`) detects this case explicitly:

```
HTTP 403 Forbidden
"This torrent has previously been rejected by moderation. Re-uploading it is not allowed."
```

To re-open a rejected row a moderator must explicitly call `/api/mod/torrents/:hash/reset` and write a note. The dedicated `reset` endpoint is the *only* path out of `rejected` — even a direct `PATCH` on the torrent metadata is blocked while the row is frozen, both for the uploader and for staff.

## Edit auto-revert

When a non-bypass member edits an `accepted` or `changes_requested` row, the patch endpoint (`/api/torrents/:hash`):

1. Applies the field changes.
2. Sets `moderation_status = 'pending'`.
3. Posts a system message in the thread:
   - `Resubmitted for review after edits.` — when the row was `changes_requested`.
   - `Edits made; returning to the moderation queue.` — when the row was `accepted`.

Bypass-flagged users (admins, mods, members with the role flag) keep the current status when they edit — they're trusted to publish without re-review.

## API surface

| Method  | Path                                                    | Auth   | Notes                                              |
| ------- | ------------------------------------------------------- | ------ | -------------------------------------------------- |
| `GET`   | `/api/torrents/:hash/moderation/messages`               | thread | Returns `{ status, messages }`. 404 if not allowed. |
| `POST`  | `/api/torrents/:hash/moderation/messages`               | thread | Free-form reply. No status change.                  |
| `POST`  | `/api/mod/torrents/:hash/approve`                       | mod    | Optional `message`.                                 |
| `POST`  | `/api/mod/torrents/:hash/request-changes`               | mod    | **Required** `message`.                             |
| `POST`  | `/api/mod/torrents/:hash/reject`                        | mod    | **Required** `message`.                             |
| `POST`  | `/api/mod/torrents/:hash/reset`                         | mod    | **Required** `message`. Body: `{ to: 'pending' \| 'accepted' \| 'changes_requested' }` (default `pending`). |

`thread` = uploader of the row OR any staff member.
