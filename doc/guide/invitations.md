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
