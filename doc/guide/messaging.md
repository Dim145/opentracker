# Messaging

Two surfaces, one relay, and a set of refusals that matter more than the
features.

1. **Private messages** — `/messages`. One-to-one, with a first-contact
   queue in front of it and optional end-to-end encryption per
   conversation.
2. **Public room** — `/chat`. One shared room, retained for a fixed
   window and then dropped by the day.

Both ship **off**. An admin opens them at
`/admin/settings → Messaging`, independently, each to one of three
audiences: off, staff only, or every member. A single boolean could not
express "staff only", which is what a rollout wants and what you fall
back to if the room turns sour.

## Live delivery is optional

The relay (`apps/relay`) is a small Go service that holds SSE
connections and fans out what it reads from one Valkey subscription. It
never touches Postgres and it makes no decisions: the API mints a
short-lived signed token that says which channels a member may listen
on, and the relay verifies the signature and nothing else.

**Without it, messaging still works.** `/api/messaging/token` answers
404 when no relay is configured and the pages fall back to reloading.
The relay is an optimisation, not a dependency — which is also why a
relay outage degrades the feature instead of breaking it.

### Configuration

| Variable | Where | Meaning |
| --- | --- | --- |
| `MESSAGING_TOKEN_SECRET` | API **and** relay | Shared HMAC key, ≥ 32 bytes. The relay refuses to start without it. A mismatch rejects every connection as forged and looks exactly like the relay being down. |
| `MESSAGING_SERVICE_URL` | API | Where the **browser** connects. A public path or URL, never a container name. `/messaging` keeps it same-origin. |
| `RELAY_ADDR` | relay | Listen address, default `:4100`. |
| `RELAY_NODE_ID` | relay | Registry name, default the hostname. Must be unique per node. |
| `RELAY_ALLOW_ORIGIN` | relay | CORS origin. Leave empty when the relay is on the site's own origin. |

Keep `MESSAGING_SERVICE_URL` same-origin if you can. The content
security policy is `connect-src 'self'`, and a relay on its own
hostname means widening it — deliberately, by naming that origin in
`NUXT_PUBLIC_RELAY_ORIGIN`.

## The node count is a deployment choice

Nothing in the code fixes how many relays there are. Each node
registers itself in Valkey under a TTL key; the API counts what is
alive, recomputes the per-node limits from that count, and broadcasts
them to every registered node.

- **Docker, one machine**: one node, in `docker-compose.prod.yml`.
  `docker compose up --scale relay=3` needs no configuration change.
- **Kubernetes**: `relay.enabled=true`, `relay.replicaCount`, or an HPA.

Three properties are worth stating because they are easy to get wrong:

- **A new ceiling applies to new connections only.** Shrinking the
  fleet never evicts anyone already connected — growing it cannot knock
  readers off, and shrinking it cannot either.
- **A node that has heard nothing serves its built-in defaults.** An
  unconfigured relay must serve, not refuse.
- **A rescheduled pod is a new node.** `RELAY_NODE_ID` comes from the
  pod name; the old registration expires on its own TTL.

### Autoscaling on connections, not CPU

`relay.autoscaling.targetConnectionsPerPod` drives the HPA from
`relay_connections`, which needs prometheus-adapter exposing it as a
pod metric. `targetCPUUtilizationPercentage` is deliberately empty:
ten thousand idle SSE readers cost almost no CPU while filling a node
completely, so a CPU target never fires and the node starts refusing
instead of the fleet growing.

`/metrics` on the relay carries what the scaling guide says to watch:

| Metric | Watch for |
| --- | --- |
| `relay_connections` | > 80 % of `relay_max_connections` |
| `relay_dropped_total` | > 0.1 % of connections per minute |
| `relay_refused_total` | any non-zero — the fleet is too small for its ceiling |
| `relay_frames_total` | trend, not threshold |

`/metrics` and `/healthz` are unauthenticated and meant to stay
internal. Neither the Caddyfile nor the Helm Ingress publishes them —
both route `/messaging/events` and nothing else.

## Backpressure closes, it never buffers

Each connection has a bounded queue. A reader that fills it is closed,
not fed. This is the load-bearing decision of the whole design: letting
the kernel buffer accumulate turns one slow phone into an outage for
everybody on that node.

Closing is safe because it is repairable — the browser reconnects with
jitter and asks the API for what it missed. A dropped client is a
visible, recoverable incident; a fed one is a leak.

## The first-contact queue

A message from somebody you have never exchanged with lands in
**Requests**, not the inbox. Accepting moves it and opens the channel
both ways. Refusing deletes it and blocks the sender **silently** — a
notified refusal is an invitation to try again from another account.

Two exemptions: staff write directly, and a reply inside an existing
conversation is never a request.

Without this, at a realistic membership, a known uploader's inbox is
unusable within weeks.

## Encryption is optional, per conversation, and permanent

The checkbox is offered **once**, when the conversation is created, and
cannot be changed afterwards — a conversation that could be
de-encrypted later never promised anything.

- ECDH P-256 → HKDF-SHA256 → AES-GCM, in the browser.
- The private key is a non-extractable `CryptoKey` in IndexedDB, **per
  device**. Another device sees the conversation and cannot read it,
  and says so rather than showing a blank.
- Whether a browser can take part is decided by comparing its key with
  the one the member **published**, not by trying to decrypt the thread's
  history. The latter is right on a second device and wrong immediately
  after a rotation: the old messages can never open again, by definition,
  so the state stayed "another device holds the key" for ever and the one
  action offered to escape it did not. Unreadable history is rendered per
  message, which is where it belongs.
- **Publishing your key is its own act**, reachable from the messages
  page whether or not you are in an encrypted conversation. It used to
  happen only as a side effect of starting one — and you could only start
  one with somebody who already had a key, so on a fresh instance nobody
  could be first.
- The checkbox appears once the recipient is known to have published;
  the lookup runs while you type, not only when the field loses focus,
  because typing a name and pressing Enter never blurs it.
- Rotating the key is an explicit act behind a confirmation, because it
  makes the existing history unreadable to you as well. Creating the
  first one destroys nothing and asks for no confirmation.
- The published key is **validated as a real uncompressed P-256 SPKI** —
  91 bytes, the right algorithm prefix. A length check alone was not
  enough: any string of the right size was accepted, so one member with a
  malformed key crashed the conversation for everyone who talked to them
  (`importKey` throws, and the page simply stopped). The client also
  treats a key it cannot import as a named state rather than letting the
  exception escape, because rows predating that check still exist.
- The room is never encrypted — the schema forbids it. A key derived
  per pair of members has no meaning in a room.

**Reporting a message is degraded, on purpose.** Staff cannot read
ciphertext. A report on an encrypted conversation carries what the
reporter chooses to quote, and nothing else.

**Every read is logged.** `GET /api/mod/messages/:id` is the one route in
this application through which somebody reads another member's private
correspondence, and it used to leave no trace whatever — the schema said
as much about itself: "this is the closest thing the app has to an audit
trail; there is no staff action log anywhere". `message_read_log` now
takes a row per read, and four decisions in it are worth stating:

- **On the read, not on the report.** A report is somebody asking; the log
  is somebody looking. They are different acts and usually days apart, and
  only the second is an access to private data.
- **Awaited, before the message is handed over.** Writing it after the
  response, or not waiting, would make the trace the part that gets
  dropped under load — which is exactly when it is worth having. A write
  that fails is logged loudly rather than swallowed.
- **The reader's name is a column, not a join.** `reader_id` is nulled
  when that account is erased; `reader_name` stays. A log that becomes a
  column of nulls in the one case where it matters most — a moderator
  erasing themselves — is not a log. The message id is not a foreign key
  either, so retention or a withdrawal cannot take the record with the
  message.
- **Visible to every moderator**, at `/mod/message-reads`, not to admins
  alone. A log the watched cannot see is surveillance; a log they can see
  is a norm. It carries no message bodies: it says a thing was opened, by
  whom, and stops.

An attempt on an encrypted conversation is recorded too, marked as having
disclosed nothing. "A moderator tried to read this and could not" is a
fact about the moderator rather than about the message.

### What the padlock covers, and what it does not

It is worth being exact, because the interface used to say "only the two
of you can read it" and that is not a claim this shape can support.

**It does cover the stored messages.** The rows hold ciphertext and the
server has no key for them. Nobody operating the instance reads a private
conversation out of the database, a moderator opening a report on one is
told plainly that there is nothing to show, and a database that leaks
leaks ciphertext.

**It does not cover the instance itself.** This is browser-delivered
encryption: the code that seals is downloaded from the same server on
every visit, and the correspondent's public key is whatever that server's
key directory hands over. An altered instance could serve different code
or a different key, and nothing in the interface would look any
different. There is no fingerprint to compare out of band — no safety
number, no key-change warning — so a member cannot detect it.

That is the standard, well-documented limit of doing this in a web page
rather than in an installed client, and it is not fixable by trying
harder inside the page. What is fixable is the wording, so the interface
now says the above rather than promising more: the padlock in a thread
header is a button, and it opens that explanation.

**Two keys, and only one of them is at issue.** A member has a portable
identity key (`did:key`, Ed25519, signs federation records) and a
messaging key (ECDH P-256, seals conversations). They are independent —
neither signs for the other, and nothing in `e2ee.ts` touches
`identityKey.ts` or the reverse.

They also have opposite custody models, which is exactly why saying "your
key" without saying which one is a way to mislead:

| | Identity key | Messaging key |
|---|---|---|
| Held by default | the instance | this browser |
| Can the member take custody? | yes, `Settings → Portable identity` | there is nothing to take — it is generated here |
| Can the instance sign / read with it? | until custody is taken, yes | never; the private key is non-extractable |
| Recoverable | export the file | no, by construction |

The settings copy used to say "this instance holds your key for you — you
can take it over: it is generated in your browser and never leaves it",
which describes the key you would GET in the present tense of the key you
HAVE. It now says what is true of each. And the padlock's explanation
names which key it is talking about, because a member who had just read
about custody in settings would otherwise reasonably conclude that taking
it fixed the caveat in messaging. It does not — the unverifiable half is
the *correspondent's* public key, which is nobody's to take custody of.

Two smaller consequences worth writing down:

- The key store is asked to persist (`navigator.storage.persist()`)
  before the key is written. WebKit deletes script-created storage after
  seven days without a visit, and the private key is non-extractable —
  a member back from a fortnight away would otherwise find every
  encrypted conversation permanently unreadable, having done nothing.
- A staff broadcast is written in clear into whichever conversation the
  pair already has, encrypted or not, because it cannot be sealed for
  each recipient. The thread marks those lines "not encrypted" rather
  than letting the padlock cover them.

## Reactions, replies and edits

**Reactions are six fixed keys**, not an emoji picker. Two reasons, and
neither is taste:

- An open picker makes the set of distinct keys per message unbounded,
  which is what turns "count the reactions on this page" into a scan.
- What is stored is a **key** (`up`, `heart`, `haha`, `wow`, `thanks`,
  `done`), not the character. `❤️` is `U+2764 U+FE0F` and `❤` is
  `U+2764`; storing the glyph would make those two different reactions to
  the same message, and any client normalising differently from another
  would silently split every count.

Reacting is a toggle — the same key twice leaves no trace — enforced by
the primary key `(message, user, key)` rather than by the handler, so a
double-tap or a retried request cannot double count.

The count strip renders **only when a message has reactions**; the "add"
trigger lives in the hover toolbar. Kept together, the strip's wrapper
was rendered on every message whether or not it held anything and
reserved its height there, leaving a band of empty space under every
line. What goes over the
relay is a **delta**, not the recomputed aggregate: four fields whatever
happens, and the reader already holds the number being adjusted.

In the room, reactions are what replace twenty separate `+1` lines. They
can also do the opposite, because reacting is cheaper than typing — which
is why the key set is fixed and a muted member cannot react. Silencing
somebody who can still stamp every message is not silencing them.

Room reactions live in a table partitioned on the **message's** day, so
the retention sweep drops them with the messages they belong to. Keyed on
their own timestamp instead, a reaction added today to a ten-day-old
message would outlive it by ten days.

**Replies carry a preview, never the message.** A reply that embedded the
full text would let a deleted message survive inside every answer to it.
A reply target must be in the same conversation — without that clause,
quoting becomes a way to confirm which message ids exist.

**Edits leave a mark.** `editedAt` is returned to every reader and shown,
because an edit that leaves no trace lets somebody rewrite what they said
after being answered — which on a surface where reports quote messages is
not cosmetic. Only the author can edit; staff can *remove* a message, and
that is a different act with a different record. In the room the window
is 15 minutes: a message four hundred people have read and six have
answered is part of a conversation, and rewriting it hours later changes
what those answers appear to reply to.

## Staff tools

**Staff skip the first-contact queue.** A moderator writing "your upload
was rejected, here is why" must not land in Requests next to the spam the
queue exists to hold, where it can be refused unread — and refusing
silently blocks the sender, so the member would then never hear from
staff again.

**Broadcasts** (`/admin/settings → Staff broadcast`) deliver one message
to a **bounded cohort** as real private messages people can answer: a
role, members inactive for N days, hit-and-run violators, or staff.

There is deliberately no "everybody". A private message to the whole
membership is not a private message — it is an announcement, and the site
already has a banner and a notification feed that cost one row between
them. Sending it as hundreds of thousands of conversations would cost
upwards of a million rows to say something nobody can usefully reply to.

The panel counts the audience **before** anything is sent, and delivery
runs behind the response with progress written to a row rather than held
in a variable: a process that restarts halfway through a loop leaves no
record of how far it got, and "did that go out?" then has no answer.

**One pinned message** in the room, stored on the conversation rather
than as a flag per message — "the pinned one" is a property of the room,
and a boolean per message allows two of them. Pinning a second replaces
the first. It disappears when retention takes the message, which is
correct: the room forgot it.

**Who may remove what**, and the two surfaces differ on purpose:

- **Private message** — the author withdraws their own; staff reach any
  message without a seat in the conversation.
- **Room** — staff only, including for your own message. A room message
  has been read by everyone present and answered by some of them, so
  removing it changes what those answers appear to reply to. The
  fifteen-minute edit window is the room's answer to a typo.

Pinning is staff only (owner, admin, moderator). Removing a pinned
message clears the pin. The read path already refused
to show a pin on a removed message, so the banner vanished on its own —
but the row stayed, leaving the room carrying a pin nobody had asked to
remove, pointing at nothing.

**Slash commands** in the room composer — `/pin` (while replying),
`/unpin`, `/mute`, `/unmute`, `/slow`, `/help`. Each maps to a route that
already enforces the permission, so they are a shortcut and never an
authority: a member who types `/mute` gets the same 403 the API would
give them. An unrecognised command is **not** sent as a message —
somebody who mistypes `/mtue` should see that nothing happened, not
broadcast their moderation intent to the room.

**Torrent links render as cards.** A 40-hex infohash tells a reader
nothing; the card resolves it to a name, a size and a swarm. Fetched by
the reader rather than embedded by the sender, so it shows the torrent as
it is now — including that it has been removed, or that this reader may
not see it. Both of those render identically, because the difference
would tell an unauthorised reader that the torrent exists.

## Role badges

One badge beside a name, never a row of them. A message line has room for
a name and a marker; five chips push the message off the screen and stop
meaning anything individually.

The order is fixed, and staff always wins:

1. Owner
2. Admin
3. Moderator
4. The highest-`priority` role the operator marked `showAsBadge`
5. Nothing

A moderator who also holds "Uploader" reads as a **moderator** — that is
the fact which changes how you read what they wrote. A role that is not
marked as a public badge never appears whatever its priority:
`showAsBadge` is the operator saying this one is a label, and a role that
only grants a permission is not something anyone asked to wear.

Resolved for a whole page in two queries, not two per message, with
`DISTINCT ON` picking the top role inside Postgres rather than shipping
every attachment to the API to throw all but one away.

### Icons never come from a CDN

`@nuxt/icon` falls back to `api.iconify.design` for anything the client
bundle does not carry. That is an external request on every page using
one — and one the site's own `connect-src 'self'` policy blocks, so the
control renders as an empty box while the page quietly reaches for a
third party. Three settings close it:

- **`fallbackToApi: false`** — an unknown icon renders nothing, which is
  a visible gap rather than a request to somebody else's server.
- **`localApiEndpoint: '/_icons'`** in the SSR shape. Nuxt's own
  endpoint, reading the full Phosphor collection out of the server
  bundle. *Not* the module default `/api/_nuxt_icon`: the reverse proxy
  sends `/api/*` to the API container, so that path 404s behind Caddy and
  falls back to the CDN — working in a bare stack and failing in
  production, the worst shape a bug can have.
- **`localApiEndpoint: '/api/icons'`** in the static shape, which has no
  Nuxt server at all. `apps/api/routes/api/icons/[collection].get.ts`
  serves the same contract, and the SPA's nginx already proxies `/api`
  there, so the request never leaves the origin the browser is on.

Everything the application draws is bundled at build time — including
every icon `IconPicker` offers and the branding quick-select grid, both
of which are JS arrays the bundler's scanner cannot see. What cannot be
bundled is what an **operator** typed and stored in the database: a
role's icon, the site logo. Those resolve through the endpoints above.

Bundling the whole collection into the browser instead would be 9161
icons and roughly 4 MB of JavaScript — eighteen times the current bundle,
to cover two admin fields.

## Notifications

A private message raises a notification on the **first unread of a
thread**, never on every message: at this membership one ping per message
makes the bell worthless within a day, and the unread badge already
carries "there is more". Muting a conversation silences the notification
and leaves the counter moving — muting means "stop interrupting me", not
"pretend nothing happened".

A first contact gets its own type, `message_request_received`, because it
is the event the queue exists to hold back. External delivery is opt-in
per type, so nothing leaves the site unless the member asked for it.

## Filing a conversation away

Archiving is per member and read-only. It removes a conversation from
your list and touches nothing on the other side — the alternative is not
filing, it is deleting in somebody else's name — and while it is on the
shelf the thread cannot be written to at all: no message, no edit, no
withdrawal, no reaction. Enforced on the server, not only in the
interface, because a rule the client alone keeps is a suggestion.

A message arriving takes it off the shelf. Without that, archiving
silences a person instead of filing their thread: the unread count would
climb inside a list nobody looks at, and the only way back would be to
remember they exist.

The way out by hand is the same control that put it there, offered on the
thread itself rather than only in the menu.

## Blocking covers every way through

A block is symmetric and silent, and "symmetric" has to mean more than
"cannot send". Editing an old line rewrites text the other side already
has and pushes an `edit` frame down their relay; a reaction pushes one
too; a read receipt pushes presence. All three are refused between two
members either of whom has blocked the other, and a direct message has no
edit window — so without that check the same row could be rewritten at
somebody for ever.

The refusal says "closed", never "you have been blocked": a refusal that
names itself is the notification the silence exists to avoid.

## Retention

Room messages live in a partitioned table, one partition per day, and
retention is enforced by dropping whole partitions — not by deleting
rows. Default 14 days, floor 24 h, set at
`/admin/settings → Messaging`.

Two consequences worth saying out loud:

- **Shortening retention deletes.** The next sweep drops every day now
  outside the window, and that cannot be undone.
- **Turning a surface off deletes nothing.** It hides it.

Private messages **can** be retained on a timer, and are not by default.
`/admin/settings → Messaging` carries the window in days; zero — the
value a fresh install and an upgrade both get — means no timer at all.
Above zero the floor is seven days.

The default is off on purpose, and it is the one retention in this
codebase that is. Every other window covers rows the instance produced
about itself; these are the members' correspondence. Switching a timer on
for them at deploy time would delete conversations nobody had been told
were on one.

The sweep (`apps/api/plugins/dm-retention.ts`) is a batched `DELETE`, not
a partition drop: a private conversation is a handful of rows a year, so
partitioning it by day the way `room_messages` is would leave the planner
carrying thousands of near-empty partitions. Two thousand rows per
statement, fifty statements per pass, so shortening a window from a year
to a month spreads the catch-up over several ticks instead of holding the
table. Only messages go — the conversation survives with nothing in it,
because a thread vanishing from an inbox with no explanation is worse
than an empty one.

An erasure destroys the **encrypted** messages outright: nobody could
read them once the key is gone. Plaintext conversations survive it with
their author blanked, because the other participant's copy is their
record of an exchange they took part in.

### Published, not just configured

Whatever is set is readable by members at `/privacy`, which is public —
no account needed, because the people deciding whether to make one are
exactly the people the notice is for. The page reads the live settings
rather than repeating numbers, since a page saying fourteen days while
the sweep runs on thirty is worse than no page. `GET /api/privacy` is the
same facts as JSON, and carries settings only — nothing about any
member — which is what lets it answer before a session exists.

## What erasure does

Account erasure keeps the `users` row and blanks it, so none of the
`ON DELETE` clauses on the messaging tables fire. Every one is done by
hand in `apps/api/utils/account/eraseAccount.ts`, and the split is:

- **Plaintext is kept, anonymised.** The messages survive; the author
  resolves to nobody and the interface renders "Deleted member". A
  frozen username would be personal data retained after an erasure
  request — which is the thing erasure exists to prevent.
- **Ciphertext is destroyed**, both sides of the conversation, along
  with the published key. A ciphertext nobody can decrypt is not a
  preserved conversation; it is unreadable bytes retained after an
  erasure request. The survivor gets an empty thread that explains
  itself rather than rows that will never open again.
- The erased account is no longer addressable: it cannot be looked up
  by name, and its key is not served.

## Federation

Out of scope, deliberately. Messages stay on the instance they were
written on. The extension point, if it is ever wanted, is the relay
channel names — `messaging:user:<id>` and `messaging:room:general` —
which are already the only coupling between writing and delivery.

## Related

- [Scaling](/guide/scaling) — how the numbers behind the limits were measured
- [Moderation](/guide/moderation) — reports, blocks and the mute log
- [Kubernetes](/guide/kubernetes) — the chart's four components
