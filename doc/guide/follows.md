# Follows

A one-way social graph: subscribe to another user, get pinged
whenever they publish. The relationship is **private to the
follower** — the followed user sees a count, never the names.

## Following a user

The follow toggle lives at the right end of the eyebrow strip on
`/users/:id`, paired with the presence pill (`6D AGO`,
`ONLINE`, …) into a single "status row".

- **Outline + count** — you don't follow this user yet.
- **Filled + count** — you do.

The count next to the button is the public follower count (a
single number, never a list).

## Notifications

The only signal the graph emits is the upload arrival:

| Event | Recipient | When |
| --- | --- | --- |
| `followed_user_upload` | Each follower | A torrent uploaded by the followed user reaches `accepted` status. |

The followed user is **never** notified of new followers — by
design. Pure subscription, no social pressure.

The notification fires on two trigger points:

1. **Auto-accepted uploads** — the moment the row lands in
   `accepted`. Fan-out runs immediately after the upload
   response so the requester response time isn't impacted.
2. **Moderation-approved uploads** — when a pending row
   transitions to `accepted` via the moderation queue. Fan-out
   runs after the transaction commits. Followers don't get
   pinged for uploads that end up rejected.

A pre-commit snapshot guards against duplicate fan-out — a
re-acceptance (e.g. `accepted → pending → accepted` from an
edit) only fires once at the first crossover.

The fan-out itself is concurrency-capped (20 workers) so a
user with 50 000 followers doesn't open 50 000 parallel
notify calls on every upload.

## /following

The follower's own management surface, at `/following`. Styled
as a **Dramatis Personae** playbill — each followed user is a
character with a hexagonal monogram portrait, name in Fraunces
italic, Roman numeral cast position, and a mini-stats line
(uploads count, ratio, last upload).

Two sort modes:
- **Récent / Recent** — newest follows first.
- **Ordre alpha / Alphabetical** — by username.

A "Sortir de scène / Exit stage" button on each card unfollows
in one click.

## Visibility

The privacy model is asymmetric on purpose:

- The **follower** sees:
  - their own `/following` list (read-only to them).
  - per-user state on every `/users/:id` they visit (follow / not).
- The **followed user** sees:
  - the public follower count on their `/users/:id` page.
  - never the list of who follows them.
- **Third parties** see:
  - the public follower count on any `/users/:id`.
  - nothing else — the graph never leaks who follows whom.

The `/api/me/following` endpoint is the only path that returns
follower identities, and it's keyed to the caller's session.

## Self-follow

Rejected at the API. Zero plausible legitimate use, infinite
noise.

## Schema

```
user_follows
├── follower_id   text → users(id)  ON DELETE CASCADE
├── following_id  text → users(id)  ON DELETE CASCADE
└── created_at    timestamp
```

Composite PK on `(follower_id, following_id)` doubles as the
"follow once" guard. Two indexes: the PK covers
`(follower_id, …)`; a separate `(following_id)` index drives
both the public count query and the upload fan-out.

ON DELETE CASCADE on both FKs keeps the graph clean — purging
either side of an edge automatically drops the row.
