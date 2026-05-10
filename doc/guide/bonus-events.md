# Bonus events

A **bonus event** is a time-bounded window during which the announce pipeline scales every `{uploaded, downloaded}` byte delta before persisting it on `users.uploaded` / `users.downloaded`.

Two well-known presets cover the classics:

- **Freeleech** — `download multiplier = 0`. Downloaded bytes don't count at all.
- **Silverleech** — `download multiplier = 0.5`. Half of the downloaded bytes count, like a partial freeleech.

Any custom combination in `[0×, 2×]` download / `[0×, 10×]` upload is also accepted. At most **one window can be active at a time** — overlap is enforced both at write time (advisory-locked transaction) and at read time (the resolver picks the most recently created row if a duplicate ever leaked).

## Admin surface (`/admin/bonus-events`)

![Bonus events admin — active Freeleech window with start / end times and the day's deltas](/screenshots/admin-bonus-events.png)

The page lists every event (active, scheduled, ended, disabled) and exposes a **New event** modal. The modal carries:

- A 3-button preset picker (Freeleech, Silverleech, Custom) that pre-fills the multiplier sliders.
- Two range sliders for the multipliers (0–2× download in 0.05 steps, 0–10× upload in 0.1 steps).
- Datetime pickers for `startsAt` / `endsAt`.
- An optional title, short description, and "explainer" long-form (the latter shown in the user-facing popup under "What is this?").
- An `enabled` toggle so a window can be drafted and disabled until ready.

The same row supports edit, toggle (suspend / resume), and delete from the list view. Toggling a disabled row back on triggers the overlap check again — staff can't accidentally stack two active windows.

## User surface

A pulsing icon (`ph:gift-fill`) appears in the navbar of every signed-in user as soon as a window goes active. Clicking it opens a popup that mirrors the original screenshot:

- Big title + countdown to the end of the window.
- Two cards rendering the multipliers — `Download 0%` (full freeleech) / `Upload 1×` (normal), `Download 50%` (silverleech) / `Upload 1×`, etc.
- Event window with start / end timestamps.
- Auto-generated explainer when the admin didn't write one.

The popup is fed by `GET /api/bonus/active` which is polled every 60s by the global composable `useActiveBonusEvent()`.

## How the multipliers reach the tracker

1. **API** — every mutation on `bonus_events` (create / patch / toggle / delete) recomputes the active row and writes a JSON snapshot to Redis under `ot:bonus:active`. The snapshot carries the multipliers (basis points × 100), the window start / end (Unix ms), and the row id.
2. **Tracker (Go)** — the announce handler reads `ot:bonus:active` through a `bonus.Resolver` with a 30-second in-memory cache. Cache miss = one Redis `GET`; cache hit = no I/O at all. The hot path costs are bounded.
3. **Apply step** — `delta * multiplier / 100`. Integer-only, no float drift. The handler caps the per-announce delta at **1 TiB** before applying multipliers so a malicious client claiming `Int64.Max` can't overflow the multiplication.
4. **Failure modes**:
   - Snapshot expired (`endsAtMs <= now`) or in the future (`startsAtMs > now`) → `Identity` (1×/1×).
   - Negative multipliers (corrupted JSON) → `Identity`.
   - Redis unreachable → `Identity` + 1-second short TTL so the next announce retries quickly.
   - **Trackers always fail open**. A misconfigured event can never silently apply an unintended freeleech to a torrent.

## Storage

```sql
CREATE TABLE bonus_events (
  id text PRIMARY KEY,
  title text NOT NULL,
  description text,
  long_description text,
  download_multiplier integer NOT NULL CHECK (download_multiplier BETWEEN 0 AND 200),
  upload_multiplier integer NOT NULL CHECK (upload_multiplier BETWEEN 0 AND 1000),
  starts_at timestamp NOT NULL,
  ends_at timestamp NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  created_by_id text REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamp
);
```

Multipliers are stored as **integer basis points (×100)** so the tracker's `delta * mul / 100` stays integer-only. UI layers divide by 100 to render `0.5×`, `2×`, etc.

## API surface

| Method | Path                                               | Auth  | Notes                                         |
| ------ | -------------------------------------------------- | ----- | --------------------------------------------- |
| `GET`  | `/api/admin/bonus-events`                          | admin | Full list, newest first, with derived status. |
| `POST` | `/api/admin/bonus-events`                          | admin | Create. Refuses overlap with another enabled row. |
| `PATCH`| `/api/admin/bonus-events/:id`                      | admin | Partial update. Same overlap guard.           |
| `DELETE`| `/api/admin/bonus-events/:id`                     | admin | Hard delete + Redis snapshot refresh.         |
| `POST` | `/api/admin/bonus-events/:id/toggle`               | admin | Flip `enabled`.                               |
| `GET`  | `/api/bonus/active`                                | any   | Polled by the navbar icon. Returns `{event:null}` when none. |
