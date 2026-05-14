# Seed bonus economy

Trackarr ships a **seed-bonus economy**: users earn points for seeding,
spend them in a shop on upload-credit and invites, and admins can grant
or revoke points by hand. Distinct from [bonus events](./bonus-events.md)
(which scale `users.uploaded` deltas globally during a window), the
bonus economy is per-user, persistent, and operator-tunable end-to-end.

## What users see

### `/me` — Bonus reserve

The profile page surfaces a compact wallet readout in the hero KPI strip
(`Uploaded · Ratio · Downloaded · Released`), plus a dedicated bonus row
that shows the running balance with an animated counter. The display is
deliberately understated — large enough to read, small enough not to
shove an admin metric into the user's face every page load.

The `Uploaded` KPI splits into "real seeded" + "(incl. X bonus)" so the
user can see at a glance how much of their lifetime upload came from
shop purchases vs. real seeding. Same data shape as the admin user
registry uses.

### `/shop` — Bonus shop

Operator-curated catalogue of items. Each item has:

| Field         | Notes                                                       |
| ------------- | ----------------------------------------------------------- |
| `name`        | Display name, free text                                     |
| `description` | Optional one-liner shown under the name                     |
| `cost`        | Points required to purchase                                 |
| `stock`       | `null` for unlimited; otherwise a hard cap                  |
| `effect`      | One of `upload_credit` / `invite`                           |
| `effect.args` | Effect-specific payload (`bytes` / `count`)                 |

The two built-in effects:

- **`upload_credit`** — adds `args.bytes` to both `users.uploaded` and
  `users.bonusUploaded` in one transaction. The user's ratio improves;
  the `bonusUploaded` subset lets the UI label that the gain came from
  the shop, not from real seeding.
- **`invite`** — adds `args.count` to `users.invitesRemaining`. Useful
  when registration is invite-only and the operator wants seeded users
  to bring in more.

Buying is gated on `cost <= bonusPoints` and on stock; the buy endpoint
runs everything inside a single transaction so a concurrent purchase
can't drop the balance into negative territory or sell the last copy
twice.

## How points are earned

The earning rules are **fully customisable** from `/admin/seed-bonus-rules`.
Each active rule contributes to a per-minute rate:

```
points/minute  ←  Σ active rules
                       per-user-context (ratio, age, seed count, torrent age, …)
```

Out of the box, three rule presets cover the classics:

| Rule                  | Curve                                                                        |
| --------------------- | ---------------------------------------------------------------------------- |
| **Time seeding**       | Flat rate per minute of active seeding (e.g. `0.1 pts/min/seed`)             |
| **Per-torrent age**   | Older torrents pay more (rewards keeping the long tail alive)                |
| **Per-torrent rarity** | Few seeds → higher per-minute rate (rewards filling rare swarms)             |

Tiered curves are a first-class concept: every rule carries an array of
`{threshold, multiplier}` tiers so the operator can write something like
"first 5 active seeds × 1.0, next 5 × 1.5, beyond × 2.0" without writing
custom code. The curves render as live previews in the admin UI so an
operator can see the shape before saving.

Granting happens on the announce hot path — every `event != stopped`
seeder pings update the per-user accumulator, which a periodic batch
flushes to `users.bonusPoints`. The accumulator is in Redis so a tracker
restart doesn't drop in-flight points.

## Admin levers

`/admin/seed-bonus-rules` — Edit, enable/disable, and re-order earning
rules. Each row carries:

- A live curve preview.
- The expected pts/minute for a "median" user (computed from current
  swarm stats).
- A toggle to disable the rule without deleting it.

`/admin/shop` — CRUD on shop items. Adding a new effect type is a
purely SQL-driven affair: insert the item with `effect.type = 'foo'`,
extend the buy endpoint's effect dispatcher, and it shows up in the
storefront immediately.

`/admin/users` — The bonus column shows the current balance and the
icon turns accent when the user has any positive points. Clicking
opens the **Adjust bonus** modal: add or remove an integer amount with
a free-text reason that's persisted in the audit log. Useful for:

- Compensating users after a tracker outage.
- Refunding shop purchases that triggered an `upload_credit` apply
  failure (rare; the buy path is transactional but the on-disk apply
  has retried writes).
- Removing points after detecting cheating.

> Adjust bonus is **admin-only** — moderators can see the registry on
> `/mod/users` but the bonus column hides its action button there to
> keep the surface focused on moderation.

## Real upload vs. bonus upload

Two separate columns track upload:

| Column                 | Driven by                                                 |
| ---------------------- | --------------------------------------------------------- |
| `users.uploaded`       | Every announce delta + any `upload_credit` shop purchase  |
| `users.bonusUploaded`  | Only the `upload_credit` shop purchase delta              |

The starter upload credit a new user gets at registration also lands in
`bonusUploaded` so the `/me` Uploaded KPI shows
`X — (incl. Y bonus)` from day zero. There's a one-shot backfill
heuristic for users who registered before this split landed: if
`users.uploaded == settings.starter_upload`, we infer the entire balance
came from the starter and stamp `bonusUploaded` to match.

The split is informational — ratio and HnR enforcement still operate
on `users.uploaded` alone. There's no concept of "real ratio"; the
distinction exists for the user's own situational awareness.

## The shop

Users spend `bonus_points` from `/shop`. The catalogue lives in
`shop_items` and is curated from `/admin/shop`; every purchase writes
a row in `shop_purchases` so the operator has a full audit ledger.

### Item types

The `type` column is a closed enum — adding a type is a three-step
contract in `apps/api/utils/shop.ts` (extend the union, add a Zod
payload schema, add the handler). Today two are shipped:

| Type             | Payload                          | Effect                                                                                          |
| ---------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `upload_credit`  | `{ bytes: integer ≤ 10 TiB }`    | Adds `bytes` to **both** `users.uploaded` and `users.bonusUploaded`. Pure ratio relief.        |
| `invite`         | `{ count: integer ≤ 10 }`        | Bumps `users.invites_remaining` by `count` slots.                                              |

The per-purchase caps (10 TiB, 10 invites) are hard-coded — they exist
so a typo in `/admin/shop` can't gift petabyte-scale ratio or
hundreds of invite slots. If you need a bigger bundle, create a second
item.

### Catalogue fields

| Field         | Notes                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------- |
| `name`        | Shown on the shop card.                                                                     |
| `description` | Markdown body, rendered below the title.                                                    |
| `icon`        | Phosphor icon id (e.g. `ph:gift-bold`). Optional.                                           |
| `cost`        | Whole points (same unit as `users.bonus_points`).                                           |
| `stock`       | `null` = unlimited. When set, decrements per purchase and the item disappears from `/shop` at 0. |
| `enabled`     | Lets an admin pause an item without losing its config.                                      |

### Purchase flow

```
              /shop                              POST /api/shop/buy
   ┌─────────────────────────┐                  ┌──────────────────┐
   │ user browses items      │ ───── buy ─────► │ purchaseItem()   │
   │ /api/shop/items         │                  │ (utils/shop.ts)  │
   └─────────────────────────┘                  └────────┬─────────┘
                                                         │
                                                         ▼
                                              ┌────────────────────┐
                                              │ DB transaction:    │
                                              │  - FOR UPDATE row  │
                                              │    lock on item    │
                                              │  - FOR UPDATE row  │
                                              │    lock on user    │
                                              │  - check balance   │
                                              │  - check stock     │
                                              │  - decrement both  │
                                              │  - apply effect    │
                                              │  - insert row in   │
                                              │    shop_purchases  │
                                              └────────────────────┘
```

The `FOR UPDATE` locks make race conditions on stock or balance
impossible. `POST /api/shop/buy` is rate-limited as a mutation, so a
hijacked session can't churn the ledger faster than the bucket
allows.

### Errors

| HTTP | Cause                                                                |
| ---- | -------------------------------------------------------------------- |
| 400  | Malformed `payload` (typically a stale admin-form submission).       |
| 403  | Item exists but `enabled = false` (paused by admin).                 |
| 404  | Item id doesn't exist.                                               |
| 409  | Stock hit zero between the listing and the buy click.                |
| 402  | Not enough `bonus_points`.                                           |

Every error returns the post-balance + a structured reason so the FE
can render a precise toast.

### Audit ledger (`shop_purchases`)

Each purchase row preserves a **snapshot of the item at buy time** —
`cost`, `name`, `payload` — so renaming or reconfiguring an item later
doesn't rewrite history. Useful for refund flows or compliance
questions: an admin can always answer "what did this user actually
spend their points on?" from the ledger alone.

## Implementation reference

| Concern                                          | File                                                                                |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Shop catalogue + buy endpoint                    | `apps/api/routes/api/shop/items.get.ts`, `apps/api/routes/api/shop/buy.post.ts`     |
| Earning rules CRUD                               | `apps/api/routes/api/admin/seed-bonus-rules*`                                       |
| Admin shop CRUD                                  | `apps/api/routes/api/admin/shop*`                                                   |
| Admin user bonus adjustment                      | `apps/api/routes/api/admin/users/[id]/bonus.post.ts`                                |
| Tracker-side accumulator (announce hot path)    | `apps/tracker/internal/server/handler.go` (seed-time recorder)                      |
| Bonus point flush (Redis → Postgres)             | `apps/api/redis/seed-bonus-flush.ts` (periodic)                                     |
| User-facing UI                                   | `apps/web/app/pages/me.vue`, `apps/web/app/pages/shop.vue`                          |

For the announce-time multipliers (Freeleech / Silverleech / custom),
see [Bonus events](./bonus-events.md). The two systems are independent
— a user can earn rate-limited points while a global Freeleech window
also doubles their `uploaded` deltas — and the announce code applies
both in the same atomic block so an event boundary can never desync
from a bonus accumulator tick.
