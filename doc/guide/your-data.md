# Your data (GDPR)

Two rights, both self-service, both from **Settings**:

- **Download a copy** of everything this instance holds about you — Art. 15
  (access) and Art. 20 (portability).
- **Erase your account** — Art. 17.

Erasure has been here since the account page existed. The export is the half
that was missing, and the odd half to be missing: the hard part — deciding what
counts as this person's data — had already been settled by the erasure, and a
dozen `/api/me/*` routes were already reading most of it a page at a time. What
did not exist was one request that returns the record *as* a record.

## The export

`GET /api/me/export` → one JSON document, saved as
`trackarr-export-<username>-<date>.json`.

JSON because Art. 20 asks for a "structured, commonly used and machine-readable
format" and it is all three, without adding a zip writer to a distroless image
for the sake of a folder structure nobody needs.

It covers: the profile and every preference; security metadata (trusted device
labels, passkey names, whether a second factor exists); notification channel
types and routing; the social graph you chose; invitations you created;
uploads, comments, forum topics and posts, presentation templates; the snatch
list with its hit-and-run bookkeeping; the bonus ledger, shop purchases and
freeleech-pool contributions; requests opened and fills attempted; tickets and
your own messages in them; reports you filed; and your notifications.

Every collection is capped at 5 000 rows and **declares its own true total**, so
a large account gets a bounded document that says it is bounded. A file that
silently stopped at the cap would be worse than one that refused: the reader
would take it for the whole record.

### Guarded like the erasure

The same two gates: a live session, and a **fresh login** (a step-up within the
last ten minutes). This endpoint answers with a person's entire history in one
response, which makes it the most valuable single request on the site to a
borrowed session.

### What is left out, and why

The file lists this itself, under `notIncluded` — an export whose omissions are
undocumented is indistinguishable from an incomplete one.

| Left out | Why |
| --- | --- |
| Other members' identities — who follows you, who used your invite, the other party in a conversation, who reported you | Their data, not yours. Counted where a count means something. |
| Credentials — the password verifier, passkey material, trusted-device tokens, the TOTP secret, notification-channel tokens and webhook URLs, your announce passkey | A live credential sitting in a Downloads folder is a worse risk than one in the database. Channel *types* and their state are exported; the credential is not. |
| Private message bodies | A conversation belongs to both parties. Encrypted ones cannot be read server-side at all — the key never leaves the members' browsers. |
| Anti-cheat findings | Art. 15 yields where disclosure would prejudice the detection of abuse. An operator can produce these from the moderation console on request. |

### The snatch list is exported even when hidden

`hideDownloadHistory` keeps the list out of a browser session — so a stolen
cookie cannot enumerate it — and this route is behind a fresh-auth step-up.
Refusing a member their own record here would be the toggle working against the
person it protects.

## Erasure

Unchanged, and documented where it always was: the account row survives as a
tombstone so the catalogue keeps standing, every personal field on it is
scrubbed, the federated identity is retracted across the mesh, and the
retentions that survive are stated rather than left to be discovered.

One addition: where the member was **staff**, their entries in the
[audit log](./audit-log.md) keep the name and lose the pointer. An act taken
under authority with no author is indefensible.

## For operators

Nothing to configure. Both routes are always available to the account itself,
rate-limited on the mutation bucket, and neither is reachable by staff on
somebody else's behalf.

What this instance keeps and for how long is published, live, at `/privacy`.
