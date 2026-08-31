# Staff audit log

Every change made from the moderation or admin console is recorded: who made
it, what it was, what it targeted, and whether it succeeded. Admins read it at
**`/admin/audit`**.

## Why it exists

This instance already kept a shelf of thematic ledgers, each good inside its
own lane — an append-only record of freeleech-pool contributions, a ledger of
every bonus grant, a discussion thread per moderated upload, a tombstone for a
withdrawn report, a log on the one route that reads private mail. None of them
answered the question asked across the whole site: *who banned this member, and
when?*

That gap sat oddly beside everything else here. Members' IPs are hashed under a
daily-rotating salt, passwords never leave the browser, the database can be
encrypted in an emergency, and an account can be erased on request — and yet
nothing could say which moderator took which decision. Protection ran one way
only. It also meant a compromised staff account left no trace.

## What is recorded

One row per **mutating** request (`POST`, `PUT`, `PATCH`, `DELETE`) to
`/api/admin/**` or `/api/mod/**`, by an authenticated staff member.

| Field | Meaning |
| --- | --- |
| Actor | Username and role **as they were at the time** — a later promotion or rename does not rewrite history |
| Action | A stable dotted key: `user.ban`, `settings.update`, `admin.federation.peers.delete` |
| Request | Method and path, query string stripped |
| Target | Type, id and a readable label, when the route names one |
| Changes | What moved, e.g. `{"isBanned":{"from":false,"to":true}}` |
| Status | The HTTP status — **failures included** |
| Address | The actor's IP, hashed like every other IP here |

Reads are **not** recorded, and neither are member-facing writes. A register of
authority records decisions; recording who looked at which page would make it a
record of everybody's activity instead.

### Refused requests are the interesting ones

A `403` from an account that should not have reached that console, repeated, is
the pattern this table exists to surface. So a refusal is stored exactly like a
success, with its status code, and the listing has a **Refused only** filter.

### Coverage is structural

The row is written by a pair of Nitro hooks, not by each route. A staff route
added tomorrow is audited before anybody writes a line for it — which is the
difference between coverage and a convention people remember for a while. A
route that knows more than its URL does can sharpen its own entry (the ban
route names the member and the reason; the settings route names the fields that
changed); one that says nothing still appears, under an action key derived from
its path and its route parameters.

## What it deliberately does not record

- **Request bodies.** They carry passwords, panic passwords, channel tokens and
  2FA secrets. A route wanting a diff passes the specific fields it means. The
  settings route records which settings were touched, never their values.
- **Post-panic recovery.** After panic mode there is no session, so there is no
  account to name. `POST /api/admin/panic/restore` is rate-limited and
  globally capped instead; see [Panic Mode](./panic-mode.md).
- **Anything a moderator merely looked at.** See above.

## Append-only

Nothing in the application updates or deletes a row. There is no edit control,
no per-row delete, and no "mark as reviewed" — a register whose entries can be
amended by the people it registers is not a register.

The single exception is retention, which removes whole rows by age.

## Retention

`audit_log_retention_days`, default **365**, `0` = keep indefinitely. A daily
sweep deletes rows past the threshold, and the value is published on the public
`/privacy` page alongside every other retention period this instance applies.

A year rather than the 90 days notifications get: the question an audit log
answers tends to be asked late, after a member disputes a ban or after a staff
account turns out to have been borrowed weeks ago.

## Who can read it

**Admins only**, enforced on the page and again on the API. Moderators fill the
table and cannot read it. That is deliberate: knowing exactly what a colleague
can see about you changes what you do in front of them, and the value of the
register is that it is read by the people accountable for the console rather
than by everyone holding a key to it. The instance owner is an admin, so they
are covered.

## Erasure

A staff member who erases their account keeps their entries, with the pointer to
their user row cleared and the **name left in place**. Banning a member is an
act taken under authority, and an act under authority with no author is
indefensible — an ex-moderator must not be able to un-sign their decisions by
closing their account. It is kept on the same basis as the invitation tree and
the reports that erasure already keeps: a record of an obligation between the
tracker and other members.

Where the erased account was the **target** rather than the actor, both the
pointer and the label go — being banned is not an act they took, it is a thing
recorded about them.

## The address is only comparable within a day

`actorIpHash` goes through the same daily-rotating-salt hash as everywhere else;
no raw IP is persisted anywhere in this system and an audit log is a poor place
to make the first exception. Two rows can therefore be compared for "same
address" only if they fall on the same day. That is enough for *this admin's
session came from somewhere else than the rest of today's actions* and not
enough for a long-range history — the same trade the rest of the codebase makes.
