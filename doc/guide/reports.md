# Reports

A community-driven moderation surface. Any authenticated user
can flag a torrent, a user, a forum post, or a torrent comment;
staff triage the queue at `/mod/reports`. Resolving a user
report can issue a ban — with an operator-set duration — in the
same action.

## Filing a report

Three entry points:

- **Torrent detail** (`/torrents/:hash`) — the "Signaler / Flag"
  button in the hero eyebrow.
- **User profile** (`/users/:id`) — the tear-off complaint tab
  on the upper-right of the dossier card.
- **Forum post** — the kebab menu on a post.

Each opens an "incident slip" modal that collects:

| Field | Validation |
| --- | --- |
| Target | Pre-filled (torrent name, `@username`, post excerpt). |
| Reason | Required, 10–500 chars. Free text. |
| Details | Optional, up to 2 000 chars. |

The reporter's identity is **never exposed to the reported
party**. Staff see it because they need it for context
(serial reporter, retaliation pattern, etc.), but the only
notification the target ever receives is the resulting
moderation action — never the report itself.

## Workflow

```
       ┌─────────┐         ┌──────────┐
       │ pending ├────────►│ resolved │   reward action: depends on targetType
       └────┬────┘         └──────────┘
            │
            └─────────────►┌───────────┐
                            │ dismissed │   no action
                            └───────────┘
```

Reports live in three states: `pending`, `resolved`, `dismissed`.
Pending reports queue at `/mod/reports`; resolved and dismissed
fall into the archive but remain searchable.

## My reports

`/me/reports` lists every report you've filed plus its current
status. A report still in `pending` can be **withdrawn** — it's
hard-deleted from the queue and never reaches staff review.

(Withdrawn reports leave no audit trail. A future iteration may
add a tombstone for spotting bad-faith reporters.)

## Staff triage

`/mod/reports` is the moderator surface. The page renders each
report as a numbered dossier with:

- Status pill (pending / resolved / dismissed)
- Target chip (torrent / user / post / comment + name)
- Reason + optional details
- Reporter handle + filing time
- Resolution note + resolver handle (for closed cases)

Two primary actions: **Reject** (dismiss) and **Resolve**
(accept). The behaviour of Resolve depends on the target type.

### Torrent reports

Accepting a torrent report **cascades**:

1. The torrent transitions to `rejected`.
2. The uploader receives a regular `upload_rejected`
   notification (same channel any manual reject would use).
3. The uploader's automatic roles are re-evaluated since their
   approved-uploads count just dropped.

The rejection note in the moderation thread is composed as
`Report accepted: {report reason}\n\nModerator note: {note}`,
so the audit trail surfaces both pieces of context.

### User reports — ban on resolution

Accepting a user report opens an inline **sanction picker** with
six options: **None**, **1 day**, **7 days**, **1 month**,
**1 year**, **Permanent**. A reason field is pre-filled with
the report's reason (editable).

Choosing anything other than None:

1. Flips `users.is_banned` to true.
2. Stamps `banned_by_id`, `banned_by_role`, and `banned_until`
   (NULL for permanent).
3. Stores the `ban_reason` text — shown on the user's bounce
   screen the next time they try to sign in.
4. Notifies the banned user (`account_banned` with duration +
   reason).
5. Notifies the inviter (`invitee_banned`) when the banned
   user came in via someone else's invite.
6. Invalidates the Redis ban cache so the lockout takes effect
   on the very next request from that user.

The ban gate enforces hierarchy: admins can ban anyone
non-admin; moderators can ban regular users but not other
moderators or admins. Self-bans are rejected.

**No IP ban** is issued through this flow — the user-targeted
report system is for the account, not the network. A separate
admin tool handles IP bans when needed.

### Forum post / comment reports

Currently no automatic cascade — staff manually delete the
offending content via the moderation surfaces if appropriate.
The report is just stamped resolved/dismissed and the reporter
is notified.

## Timed bans & auto-unban

A ban issued with a duration sets `banned_until` to the absolute
timestamp the ban expires. Two paths lift it:

- **Cron** — every 5 minutes a sweep scans
  `is_banned = true AND banned_until < NOW()`, clears
  `is_banned`, and notifies the user with `account_unbanned`.
  Coordinated across replicas with a Redis SETNX lock.
- **Lazy** — login, Torznab, and the Go tracker all check
  `banned_until` before rejecting an `is_banned = true` user.
  If the ban has expired the row is unbanned inline so the
  user can sign in even if the cron hasn't ticked yet.

The two paths are idempotent — the cron filters on
`is_banned = true` so a lazily-cleared row isn't reprocessed.

A permanent ban (`banned_until` NULL) is never lifted by the
cron; only a manual unban from `/admin/users/:id/unban`
clears it.

## Notifications

| Event | Recipient | When |
| --- | --- | --- |
| `new_report_filed` | Every staff member | A user filed a new report. |
| `report_actioned` | Reporter | Staff resolved or dismissed the report. |
| `account_banned` | Banned user | Their account was just banned. Carries duration + reason. |
| `account_unbanned` | Unbanned user | Cron lifted a timed ban OR staff manually unbanned. |
| `invitee_banned` | Inviter | Their invitee got banned (so they know their invite reputation took a hit). |

## What a banned user sees

- **Web** — the login form rejects with "Your account has been
  banned" + the reason if set. Active sessions die at the
  next API call (every protected route re-reads `is_banned`).
- **Torznab API** — every request returns the standard
  `ACCOUNT_SUSPENDED` error code.
- **Tracker** — announces are rejected with "User is banned"
  before reaching the swarm logic.

The passkey itself is **not rotated** on ban. The ban flag is
checked everywhere the passkey is used, so the key stops
working everywhere the moment the ban is committed. On unban
(manual or auto) the same passkey resumes working.

## Privacy

- The reporter's identity is staff-only; the reported user
  never sees who flagged them.
- The reason / details payload is staff-only too — the only
  thing surfaced to the target via notifications is the
  `actorUsername` of the resolving staffer and the moderator's
  free-text reason (when issuing a ban).
- Withdrawing a pending report removes it entirely; no trace
  in the staff queue.

## Admin surfaces

- `/mod/reports` — the queue, with status filter + search by
  reason.
- `/admin/users/:id/ban` — the dedicated ban endpoint, also
  callable from staff tooling outside the report flow.
- `/admin/users/:id/unban` — the matching unban path, refuses a
  moderator trying to lift an admin-issued ban (the
  `banned_by_role` snapshot enforces the hierarchy).
