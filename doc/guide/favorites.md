# Favorites

A private bookmarking surface. Stars on torrents, a personal
catalogue at `/favorites`. Strictly **viewer-only** — no
uploader notification, no public counter, no profile-page
exposure.

## Pinning a torrent

Two affordances:

- **Detail page** (`/torrents/:hash`) — the star toggle in the
  hero eyebrow, next to the report flag. Filled / outline
  reflects the current state.
- **Listing rows** (`/torrents` and elsewhere) — a small star
  in the rightmost column of every row. Click toggles without
  navigating into the detail.

The toggle is optimistic: the star flips state instantly and
rolls back if the API call fails. A toast confirms each
direction.

## The catalogue

`/favorites` is your personal index. Each starred torrent
becomes a card in a letterpress library catalogue:

- Numbered serial (`N° 0042`) — stable across pages, based on
  the order you pinned the row.
- Date stamp (`MAY 16 2026`) — when you pinned it.
- Category chip, title, live swarm stats (seeders / leechers /
  size).
- A red "Retirer / Return" stamp at the bottom-right of every
  card to unpin in one click.

Three sort modes:
- **Récent / Recent** (default) — newest pins first.
- **Nom / Name** — alphabetical.
- **Seeders** — most seeded first.

## Privacy

- The list is per-user; only you can read it. There's no
  `/users/:id/favorites` route.
- The uploader of a starred torrent is **never** notified —
  starring is a private bookmark, not a social signal.
- There's no public "X people starred this" counter on the
  torrent surface.

## Schema

```
torrent_favorites
├── user_id      text → users(id)     ON DELETE CASCADE
├── torrent_id   text → torrents(id)  ON DELETE CASCADE
└── created_at   timestamp
```

Composite primary key on `(user_id, torrent_id)` doubles as the
"can't favorite twice" guard — the POST endpoint can use
`ON CONFLICT DO NOTHING` without a separate unique index.
ON DELETE CASCADE on both FKs keeps the table clean when a user
or torrent is purged.
