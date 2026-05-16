# Upload Requests

A user-driven bounty board where members request specific
uploads and stake bonus points as a reward. The points are held
in escrow until either the requester validates a filler's
proposal, the request is cancelled (refund), or the server auto-
validates the proposal after the configured timeout.

The whole feature lives at `/requests`. Browse open bounties,
post your own, fill someone else's, discuss in the thread.

## Lifecycle

```
                ┌─────────┐  cancel  ┌───────────┐
                │ requested├─────────►│ cancelled │
                └────┬─────┘          └───────────┘
                     │  fill            ▲
                     ▼                  │  reject
                ┌─────────┐  ──────────►│
                │ filled  ├─────────────┘
                └────┬────┘
                     │ validate (manual or auto)
                     ▼
                ┌────────────┐
                │ validated  │
                └────────────┘
```

| Status | Meaning |
| --- | --- |
| `requested` | Open — anyone except the requester can submit a torrent to fill it. |
| `filled` | A proposal is awaiting the requester's decision. |
| `validated` | The proposal was accepted; the reward is paid to the filler. Discussion is locked. |
| `cancelled` | The requester pulled the request before any active fill; reward refunded. Discussion is locked. |

## Posting a request

From `/requests`, click **Nouvelle demande / New request**. Fields:

- **Category** — pick any existing category (subcategories
  included). Fills are validated against this — a torrent
  uploaded under `TV/HD` satisfies a request filed under `TV`.
- **Title** — 3–200 characters.
- **Description** — 10–4 000 characters. Free-form text;
  include language, quality, edition, season range — anything
  that helps the filler propose the right release.
- **Reward** *(optional)* — 0 to 1 000 000 bonus points. The
  amount is debited from your balance the moment you post.
  You can bump it later (only upward — see [editing](#editing));
  drops aren't allowed because lowering the prize after fillers
  have started watching is bad faith.

A "balance after stake" preview shows your projected balance so
you don't over-commit.

## Filling a request

Anyone except the requester can fill an open request:

1. Upload the torrent through the regular flow at
   `/torrents/upload`. It must reach `accepted` moderation
   status before it can be used as a fill.
2. On the request's detail page, paste the infoHash into the
   **Fill** field and submit.

The server checks:
- the request is still `requested` (not filled / closed),
- the caller is the uploader of the torrent,
- the torrent is `accepted` (pending / rejected torrents don't
  earn rewards),
- the torrent's category matches the request's, **or is a
  descendant** in the category tree,
- the caller hasn't exhausted their per-user attempt cap on
  this specific request (see [admin config](#admin-settings)).

On success the request flips to `filled` and the requester is
notified.

## Validation & rejection

Once a fill is in flight the requester has three options:

- **Validate** — the reward is transferred to the filler. Both
  status `validated` and the points move atomically inside a
  single transaction.
- **Reject** — the proposal is bounced. The request flips back
  to `requested` so other users can step in. The rejected
  filler's per-user attempt counter ticks up; once they hit the
  cap they're locked out of this specific request (other
  requests are unaffected).
- **Wait** — after the auto-validate timeout (default 7 days,
  operator-configurable), the cron treats silence as consent
  and credits the filler.

Both parties receive a notification on every transition.

## Discussion

Each request carries a thread. Any authenticated user can post,
ask for clarification, suggest a release, share context. The
thread freezes the moment the request reaches a terminal state
(`validated` / `cancelled`) — closed cases stay readable but no
new comments accumulate.

- Author edits within **15 minutes** of posting.
- Past the window, only staff can soft-delete a comment. The
  row stays so the thread numbering is stable; the body is
  hidden behind a "removed by moderation" placeholder.
- The poster's username + a 200-char preview travel to the
  other party as a `request_new_comment` notification.

## Editing

You can edit your own request while it's still in `requested`
state. Title, description, and category are all freely editable.
The reward is **bump-only** — increasing the stake debits the
delta from your balance the moment you save; lowering it is
refused.

Cancel is also gated on `status = 'requested'`. If a torrent
has been proposed you must reject it first to free the slot,
then cancel.

## Points & escrow

The escrow is a strict ledger:

1. On creation, the reward is deducted from your `bonus_points`.
2. On a reward bump, the **delta** is deducted.
3. On cancel, the **full reward** is refunded to you.
4. On validate (manual or auto), the **full reward** is paid to
   the filler.
5. On reject, nothing moves — the reward stays in escrow.

Every transition runs in a single Postgres transaction with row
locks on the user balance(s), so two clicks or two tabs can't
double-pay or double-refund. Each path also re-checks the
status inside the transaction; the losing race returns 409
"Already resolved" rather than mutating points twice.

## Notifications

The five request events route through the regular notification
system. They appear under a dedicated **Requests / Demandes**
category in `/settings → Notifications` and can be sent to any
external channel (ntfy, Discord, …) like any other type.

| Event | Recipient | Fires when |
| --- | --- | --- |
| `request_filled` | Requester | Someone proposed a torrent. |
| `request_validated` | Filler | The requester accepted; reward paid. |
| `request_rejected` | Filler | The requester bounced the proposal. |
| `request_auto_validated` | Both | The cron auto-paid past the timeout. |
| `request_new_comment` | Requester + active filler | Someone (else) posted in the thread. |

## Auto-validation

A request that sits in `filled` past the timeout is auto-paid by
a 10-minute cron. The timeout default is **168 hours (7 days)**
and is operator-configurable; the partial index
`upload_requests_filled_at_idx` keeps the scan cheap even with a
six-digit historical table.

The cron is race-safe with the manual paths: the status flip
runs as a conditional UPDATE that only matches `filled` rows,
and the reward is only paid on a non-empty result, so a
requester who validates milliseconds before the cron ticks
doesn't risk a double-payment.

## Admin settings

`/admin/settings → Bourse aux demandes` exposes two tunables:

- **Auto-validate timeout** (1 h – 1 year, default 168 h /
  7 days).
- **Max proposals per user** (1 – 20, default 3). Caps how many
  torrents a single filler can stack on the same request —
  rejections + the active proposal both count, so a user who
  keeps spamming a request gets locked out after N tries.

The cron runs every 10 minutes by default — override with
`REQUEST_AUTO_VALIDATE_INTERVAL` (in ms) if you want a tighter
or looser cadence.

## Search & filters

The board accepts:

- **Status** segment — Open / Filled / Validated / Cancelled / All.
- **Mine** toggle — restrict to requests you posted.
- **Search** — free text on titles, split on whitespace and
  AND-joined (so `cowboy bebop` matches titles containing both
  terms).
- **Pagination** — 24 per page.

## Security & abuse prevention

- The reward is held in escrow in a single transaction at
  creation time and cannot be spent elsewhere.
- Self-fills are rejected (a user can't claim their own bounty).
- A unique partial index on `(request_id, user_id)` where
  `status = 'proposed'` makes "one active proposal per user
  per request" a DB-level invariant.
- The per-user fill cap is re-counted inside the fill
  transaction under a `SELECT ... FOR UPDATE` row lock, so two
  parallel fills from the same user can't both pass the check.
- All mutations are rate-limited under the standard mutation
  bucket.

## Frequently asked questions

**Can I post a request with no reward?** Yes — set the reward
to 0. The request still appears on the board; fillers who
volunteer do so for goodwill rather than points.

**What happens if my balance drops below my staked reward
before the request is filled?** Nothing — the reward was
debited at creation and is held in escrow. Your visible
balance always already accounts for the held amount.

**Can a moderator cancel someone else's request?** No, only
the requester can cancel. Staff can soft-delete the thread's
comments but not move points or close the case.

**A user keeps spamming garbage proposals on my request — what
do I do?** Their per-user cap will lock them out after N
rejected attempts (default 3). If they're a serial abuser
across many requests, file a `user` report from their
profile — see [Reports](./reports.md).
