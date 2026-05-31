# Federation

Connect independent Trackarr instances so they can share **catalogue,
social activity, account proofs and (optionally) swarms** — a private,
owner-curated network rather than one monolithic tracker. Every instance
stays sovereign: it keeps its own users, ratio economy, moderation and
data, and decides — per partner, per direction — exactly what it shares.

Federation is **off by default** and only the **owner** (an admin) can turn
it on, from `/admin/federation`.

## Trust model

There is no central authority and no PKI. Trust is established **once, by
hand**, between two owners.

- Each instance owns a single **Ed25519 keypair**, generated lazily the
  first time federation is enabled. The private key is encrypted at rest
  (same cipher as notification-channel secrets — `CHANNEL_ENCRYPTION_KEY`,
  falling back to `NUXT_SESSION_SECRET`).
- An instance's **`instanceId`** is the fingerprint of its public key
  (`tk_` + truncated SHA-256 over the SPKI). It can never drift from the
  key it names.
- Every server-to-server (S2S) request is **signed** (see [Security](#security)).
- A peer only exists once it's in your **allow-list** (`federation_peers`),
  added through a **double opt-in handshake** that both owners confirm.

### The handshake (double opt-in)

```
Owner A                                  Owner B
  │  add B's URL in /admin/federation
  │  POST /api/federation/handshake  ───────────►  pending_in row + owner notice
  │            (status: pending_out)               (B verifies A's fingerprint)
  │                                                 owner B approves → scopes chosen
  │  ◄───────  POST /api/federation/callback ─────  (status: active on B)
  │  status: active                                 callback signed with B's key
```

1. **A initiates.** Owner A enters B's public URL. A sends a signed
   `handshake` carrying A's public key + offered scopes; A's side is now
   `pending_out`.
2. **B reviews.** B stores a `pending_in` row and notifies its owner.
   Owner B verifies the **short fingerprint** (e.g. `8E·44·A2`) with owner A
   **out of band** (the only defense against an impostor URL) and approves,
   choosing what B shares and accepts.
3. **B calls back.** B flips to `active` and sends a signed `callback`; A
   flips to `active` too. The link is live.

Re-handshakes from a known peer never silently re-open a `blocked`/`revoked`
link, and a `callback` only ever **completes** an outbound handshake — it
can't rewrite an established link's scopes.

## Scopes

Sharing is **granular and asymmetric**. For each peer you set two
independent scope sets:

| Field             | Meaning                              |
| ----------------- | ------------------------------------ |
| `sharesWithThem`  | what **you expose** to that peer     |
| `acceptsFromThem` | what **you consume** from that peer  |

Each set is four booleans:

| Scope      | Unlocks                                                        |
| ---------- | ------------------------------------------------------------- |
| `catalog`  | torrent metadata discovery (browse + search)                  |
| `social`   | federated comments & forum, follow notifications              |
| `accounts` | identity-link verification + read-only reputation             |
| `swarm`    | peer cross-announce (highest risk — see [Swarm](#axis-4-swarm))|

You can cut one scope without touching the others (e.g. drop `social`,
keep `catalog`) at any time from the peer's **Manage** dialog — it takes
effect on the next request.

## The four axes

### Axis 1 — Catalogue

Discover and search partner content without touching swarms.

- **Cache mode (default).** A background cron (`FEDERATION_SYNC_INTERVAL`,
  15 min) pulls each `catalog`-sharing peer's catalogue into a local,
  read-only mirror (`remote_torrents`) via a signed, paginated
  `GET /api/federation/catalog`. Browse it at **`/federated`**.
- **Live mode.** Toggle **Live** on `/federated` to fan out a signed
  `GET /api/federation/search?q=` to every partner in real time
  (time-bounded, best-effort).
- **Dedupe.** A remote item already present locally is flagged
  *"also here"* (same info-hash) or *"same content here"* (same
  content-signature, different info-hash). Hints only — the mirror is
  **never** merged into your local `torrents` table.
- **Download.** A federated torrent's link points **back to the origin
  instance** — you download there, with your account there. Trackarr never
  serves a partner's `.torrent` with your local passkey.

What crosses the wire is metadata only: name, size, category, tags, media
IDs, stats, and the uploader's **display name** — never the `.torrent`
bytes nor a real user id.

### Axis 2 — Social

A light fediverse layer, pull-based and read-only.

- **Follows.** Follow a remote uploader from `/federated`; when the
  catalogue sync first sees a new upload by someone you follow, you get a
  `federated_followed_upload` notice (capped per run; the initial backlog
  is never blasted out).
- **Comments & forum.** A remote torrent's comments and a partner's recent
  forum topics are fetched live, rendered **read-only** with attribution,
  and **sanitized** exactly like local content (DOMPurify). Aggregated forum
  view at **`/forum/federated`**.
- **Sovereignty.** Everything remote is gated on the peer's `social` scope;
  cut it and the exchange stops immediately. No remote moderation is ever
  imposed on you.

### Axis 3 — Accounts & reputation

Portable identity, never portable economy.

- **Linked identity (recommended).** A local user proves they own an
  account on a partner: Trackarr issues a one-time `trackarr-verify-<hex>`
  code, the user pastes it into their **bio on the partner**, and a signed
  `GET /api/federation/verify-identity` confirms it server-side. A
  "verified on partner.example" badge appears. Manage at
  **`/federated-identity`**.
- **Reputation (read-only).** For a verified link, ratio / uploads /
  member-since can be pulled as a **display signal**, always labeled with
  its source. It is **never** folded into your local ratio, bonus or
  invites.
- **No SSO.** Single sign-on is intentionally out of scope — the
  zero-knowledge auth model makes it unsafe, and account economies stay
  isolated.

### Axis 4 — Swarm

::: warning Highest risk — off by default
A private tracker deliberately isolates swarms. Cross-announce pierces that
isolation, so it is gated three ways and ships disabled.
:::

Mutualise seeders/leechers between instances, but only when **all** of:

1. the tracker has `TRACKER_FEDERATION_SWARM=true` (off by default), **and**
2. the peer link has the `swarm` scope (both directions), **and**
3. the individual torrent is opted in (`federate_swarm`, toggled by the
   uploader or staff on the torrent page).

When enabled, the API pulls partner peers (signed) into a short-lived Redis
cache (`remote_peers:{infoHash}`) and the Go tracker mixes them into the
announce response. Exposure is minimal and hardened:

- only `ip`/`port`/`isSeeder` leave — never `peer_id`, `ipHash` or a user;
- private / loopback / link-local IPs are **filtered out** both when
  exposing and when ingesting;
- a 60-min freshness window and a per-torrent cap apply.

**Ratio integrity is preserved**: each instance only ever counts its own
announcing users. Remote peers are injected read-only into the peer list —
they never enter ratio, Hit-and-Run or stats accounting.

## Governance

From `/admin/federation`, per peer, the owner can:

- **Approve** an inbound request (choosing scopes).
- **Suspend / Reactivate** — pause exchange without deleting the link.
- **Block** — refuse a peer.
- **Edit scopes** — change what you share/accept after the fact.
- **Remove** — delete the link entirely.

Status transitions are enforced by a central validator (a `revoked` link is
terminal; a pending handshake must be approved or deleted, not patched). Any
non-`active` status immediately makes every inbound S2S endpoint reject the
peer.

## Security

| Concern        | Measure                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------- |
| Authenticity   | Ed25519 HTTP message signatures on every S2S call: `x-trackarr-instance/date/digest/signature`. |
| Tampering      | The signature covers `METHOD \n PATH \n DATE \n DIGEST`; `digest` binds the exact body bytes. |
| Replay         | ±5-min clock window **plus** a per-signature nonce cache (Redis `SET NX`).                     |
| Identity       | `instanceId` is the public-key fingerprint; the handshake rejects an id that doesn't match.   |
| Authorization  | Every inbound endpoint checks allow-list + `status==='active'` + the required scope, in one shared guard. |
| Abuse          | IP rate-limit **and** a per-`instanceId` rate-limit (can't be bypassed by rotating egress IPs). |
| SSRF           | All outbound calls go through `safeFetch` (blocks loopback / private / link-local / metadata ranges, re-validates every redirect hop). |
| XSS            | Remote text is DOMPurify-sanitized; partner-supplied URLs are http(s)-only before any `:href`. |
| Economy        | Remote catalogue is a read-only mirror; reputation is display-only; swarm peers never touch ratio. |
| Secrets        | The instance private key is AES-GCM encrypted at rest.                                        |

## Configuration

Federation introduces **no required** variables — it provisions its key on
first enable.

| Variable                   | Read by | Default           | Purpose                                                              |
| -------------------------- | ------- | ----------------- | -------------------------------------------------------------------- |
| `FEDERATION_SYNC_INTERVAL` | api     | `900000` (15 min) | Catalogue-sync cron period (ms). No-op while federation is disabled. |
| `TRACKER_FEDERATION_SWARM` | tracker | `false`           | Master switch for swarm cross-announce on the Go tracker.            |
| `CHANNEL_ENCRYPTION_KEY`   | api     | —                 | Encrypts the instance private key at rest (falls back to `NUXT_SESSION_SECRET`). |

::: tip Local two-instance testing
`safeFetch` blocks loopback and private ranges by design, so two instances
on the same host/LAN can't federate over `localhost`/RFC-1918 addresses.
Use public hostnames (an explicit host allow-list is not implemented yet).
:::

## Data model

All federation state lives in dedicated tables — the local economy schema
is untouched.

```
federation_config        singleton: master switch, this instance's identity, default scopes
federation_peers         the allow-list: base_url, instance_id, public_key, status,
                         shares_with_them / accepts_from_them (jsonb scopes)
federation_sync_state    per-peer × resource sync cursor (catalogue watermark)
remote_torrents          read-only mirror of partner catalogues (never merged into `torrents`)
federated_follows        local user → remote username subscriptions
federated_identities     local user ↔ remote account links (pending / verified)
torrents.federate_swarm  per-torrent swarm opt-in flag
```

Swarm cross-announce uses **no table** — it's a Redis cache
(`remote_peers:{infoHash}`) read by the Go tracker behind its flag.

## Pages at a glance

| Page                    | What                                                       |
| ----------------------- | ---------------------------------------------------------- |
| `/admin/federation`     | Owner console: master switch, identity, peers, governance. |
| `/federated`            | Browse/search the federated catalogue (Cache / Live).      |
| `/federated/:id`        | A remote torrent's detail + live comments.                 |
| `/forum/federated`      | Aggregated partner forum topics.                           |
| `/federated-identity`   | Manage your linked remote identities + imported reputation.|
