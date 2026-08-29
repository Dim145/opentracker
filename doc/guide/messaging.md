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
- Rotating the key is an explicit act behind a confirmation, because it
  makes the existing history unreadable to you as well.
- The room is never encrypted — the schema forbids it. A key derived
  per pair of members has no meaning in a room.

**Reporting a message is degraded, on purpose.** Staff cannot read
ciphertext. A report on an encrypted conversation carries what the
reporter chooses to quote, and nothing else.

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
