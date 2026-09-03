# Invitations

Trackarr's invitation system has two surfaces:

- **`/invites`** — a member's own invitation registry. Generate codes, share them, see who redeemed each one, regenerate when codes expire.
- **`/admin/invites`** — the staff queue. Top up a member's quota, browse the registry-wide log, strike codes that need to disappear.

Both are gated by the [registration mode](#registration-mode) — if registrations are fully closed nobody can use a code.

## Member view (`/invites`)

![Member invitations page — editorial registry layout with the 30-day window selected](/screenshots/invites.png)

A member's "Invitation Registry" is the only place where the **full code** is ever revealed. The page tells the user:

- How many invitations they have left to extend (their `users.invites_remaining` quota).
- A `Cast invitation` button — pick the validity window (1d / 7d / 30d / 90d / forever) and generate a code. The code is shown **once** in a sealed-letter modal with both the code itself and a ready-to-share URL (`/auth/register?code=XXXX...`).
- A numbered ledger of every code they have drafted, with status (`active` / `used` / `expired`), expiry date, and — for codes that were redeemed — a clickable link to the recipient's profile.

The user can:

- Copy the code or the invite link directly from the reveal modal.
- Strike an unused code from the ledger. **Active** strikes refund the slot to the member's quota; **expired** strikes don't (otherwise the expiration window could be bypassed by waiting and recycling).
- Used codes can never be deleted — the link to the redeemed account is kept for accountability.

::: tip
The invitation count decrements at **code creation**, not at redemption. Generating three codes against a 3-invite quota leaves the quota at 0, even before the codes are used. Striking an active code restores the slot.
:::

## Admin view (`/admin/invites`)

![Admin invitations console — KPIs, filters and the registry-wide ledger with masked codes](/screenshots/admin-invites.png)

Staff manage the registry from a dedicated admin page:

- **Grant invitations** — find a user by username (debounced autocomplete against `/api/admin/users`) and bump their quota. The autocomplete shows each candidate's current `invites_remaining` so it's clear how many they already hold.
- **KPIs** — total emitted, active, used, expired, all derived from the same `invitations` rows.
- **Filterable ledger** — segmented filter (All / Active / Used / Expired) plus a free-text filter against the masked code, the creator, or the recipient.
- **Strike** — admin override. Removes a row regardless of who created it. If the row was active the slot is refunded to the original creator; expired/used strikes don't refund.

### Codes are masked from staff

::: warning
Admins **cannot** see the full code. The `GET /api/admin/invites` response only carries a `codePreview` of the form `<first 8>…<last 4>`.
:::

The middle 80 bits of entropy stay opaque, so staff cannot:

- Copy a member's pending code and redeem it themselves (or hand it to someone else).
- Brute-force a redemption from a collected preview.

Striking a code only requires the row id, which the admin already has in the ledger. There is no "copy" affordance on this surface — the visible cell is informational only.

## Registration mode

`/admin/settings` exposes a three-state picker that controls whether codes are even relevant:

| Mode          | `registration_open` | `invite_enabled` | What happens                                            |
| ------------- | ------------------- | ---------------- | ------------------------------------------------------- |
| `closed`      | false               | false            | No new accounts. The login page hides the sign-up link. |
| `invite_only` | false               | true             | A valid code is required at `/auth/register`.           |
| `open`        | true                | (forced false)   | Anyone can sign up. The code field becomes optional.    |

Switching modes mid-flight is safe: the running middleware reads the live values on every page load.

## API surface

| Method  | Path                            | Auth        | Notes                                                                   |
| ------- | ------------------------------- | ----------- | ----------------------------------------------------------------------- |
| `GET`   | `/api/invites`                  | session     | Caller's own codes + remaining quota.                                   |
| `POST`  | `/api/invites`                  | session     | Body: `{ expiresInDays: 1 \| 7 \| 30 \| 90 \| null }`. Decrements quota.  |
| `DELETE`| `/api/invites/:id`              | session     | Strikes one of the caller's codes. Refunds active rows only.           |
| `GET`   | `/api/admin/invites`            | admin       | Paginated registry-wide list; codes are masked.                         |
| `POST`  | `/api/admin/invites/grant`      | admin       | Body: `{ userId, count }`. Bumps a user's `invites_remaining`.          |
| `DELETE`| `/api/admin/invites/:id`        | admin       | Admin override. Refund mirrors the user-side rule (active → creator).   |

The auto-fill of the code field on `/auth/register?code=XXXX...` is wired client-side: the page reads `route.query.code`, trims and uppercases it, and seeds the form. An invalid value is rejected by the same back-end check used by manual paste.

---

## The invite tree

**Admin → Invite tree** walks the genealogy in both directions from any member:
who vouched for them, and who they let in.

The procedure it serves is standard across the trackers that have had it for
decades. An account is banned for cheating, and the first question is who
vouched for them — because whoever did is either careless or complicit, and
their other invitees are worth a look.

The data has always been here, in `invitations.created_by` and
`invitations.used_by`. Both pages that read it only ever rendered one
generation.

### Getting there

From the sidebar, or — more usefully — from **Invite tree** in the staff section
of any member's profile, which opens the page already on that member. The
procedure starts on the account you suspect, so retyping a username was the
wrong way in.

### Reading it

- **Sponsors** is a chain, nearest first: `generation 1` is whoever invited the
  member you looked up, and each step right is one generation further back.
- **Invited by …** is a tree, indented by generation, with one guide line per
  generation so a name can be traced to its own sponsor. A summary line above it
  gives the figure the procedure runs on: how many members, **how many of them
  are banned**, and over how many generations.
- Each row carries the date the invitation was used, so a cluster of bans can be
  told apart from three years of ordinary history.
- A **banned** account is marked in words as well as in colour. An **erased** one
  renders as a tombstone rather than a link — erasure scrubs the username and
  leaves every invitation row intact, so the *edges* survive perfectly, which is
  exactly what a genealogy needs, but the name behind them is gone.
- The tree is announced as a tree: each row carries its generation as
  `aria-level`, so the hierarchy is not carried by indentation alone.

### Where a chain ends

Two different endings, and the page distinguishes them:

- **`root`** — nobody invited this member. They are either the first account or
  they registered while registration was open. Those two are indistinguishable
  in the data, and saying "root" rather than showing an empty list is what stops
  a reader assuming the record is incomplete.
- **depth limit** — the chain goes further up than this view walks.

### Bounds

Ten generations each way, four hundred members in total. A prolific inviter
three generations down is a lot of rows, and an unbounded recursive walk over a
social graph is a query nobody meant to write. The page says when it truncated.
