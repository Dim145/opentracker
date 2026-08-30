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

## Reachable, and not

Six capabilities have routes and, as of today, **no way in from the
interface**: blocking a member, searching a conversation, archiving a
thread, muting one, deleting a private message, and staff reading a
reported message. Three of those are P7 features that were reported as
delivered and were only half of it — the API half.

They are listed here rather than quietly left out because a route with
no caller reads as working code until somebody looks for the button.

## Retention

Room messages live in a partitioned table, one partition per day, and
retention is enforced by dropping whole partitions — not by deleting
rows. Default 14 days, floor 24 h, set at
`/admin/settings → Messaging`.

Two consequences worth saying out loud:

- **Shortening retention deletes.** The next sweep drops every day now
  outside the window, and that cannot be undone.
- **Turning a surface off deletes nothing.** It hides it.

Private messages are not retained on a timer. They are deleted when a
participant deletes them, or when an account is erased.

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
