# Trackarr federation — feasibility study & architecture

> Status: **design proposal** (RFC). No application code is written yet.
> Realises the `Future (v1.x+) — Federation, inter-tracker communication` line of the [roadmap](../guide/roadmap.md).
> Agreed scope: **full** federation (catalogue + social + accounts/reputation + swarm), **owner-controlled allow-list**, **in-house Trackarr↔Trackarr protocol**.

---

## 1. TL;DR

Yes, it is feasible, and the codebase is **well positioned**: UUID v4 identifiers (no cross-instance collisions), solid content identity already in place (`info_hash` + `content_signature` + media IDs), a key-value `settings` table for owner toggles, and several server-to-server security building blocks already present (`safeFetch` anti-SSRF, `ADMIN_API_KEY`, distributed Redis rate limiting).

The proposal breaks into **5 independently shippable phases**, in increasing order of risk:

| Phase | Axis | Risk | Touches the Go tracker? |
|---|---|---|---|
| **0** | Trust foundation (handshake + allow-list + signed transport) | Low | No |
| **1** | Catalogue / metadata (federated discovery) | Low | No |
| **2** | Social (comments, forum, federated follows) | Medium | No |
| **3** | Accounts / reputation (portable identity & ratio) | High | No |
| **4** | Swarm / peers (cross-announce) | **Very high** | **Yes** |

The split lets us deliver value from Phase 1 onwards without ever committing to the risky phases. Phase 4 (swarm sharing) is in **direct tension with the private nature of the tracker** and carries a dedicated warning (§7.4).

---

## 2. Goal & scope

Let several **independent** Trackarr instances communicate and share their data, with activation and partner selection **decided by each instance's owner**.

**Founding principle — instance sovereignty.** Federation is never imposed: each instance stays in control of (a) whether it federates, (b) with whom, (c) what it shares, (d) what it accepts. The link is **bidirectional and double opt-in** (both owners must agree).

---

## 3. Codebase assessment

### 3.1 What helps (already in place)

| Asset | Where | Why it matters |
|---|---|---|
| **UUID v4 everywhere** | `packages/db/src/schema.ts` | No ID collisions between instances — obstacle number one is already cleared. |
| **Content identity** | `info_hash` (unique), `content_signature` (SHA-256 of the files, already computed for cross-seeding), media IDs (`imdb_id`/`tmdb_id`/`tvdb_id`/`igdb_id`/`openlibrary_id`) | Recognising "the same content" from one instance to the next, deduplicating, merging releases. |
| **Owner toggles** | `settings` table (key-value + cross-replica invalidation over Redis pub/sub), `admin.ts` middleware | An admin-only `federation_enabled` plugs straight in with no redeploy. |
| **Hardened outbound HTTP** | `apps/api/utils/safeFetch.ts` | Anti-SSRF, revalidates every redirect — indispensable for calls to third-party hosts. |
| **Machine-to-machine auth** | `apps/api/utils/auth.ts` (`ADMIN_API_KEY`), constant-time compare | The basis for server-to-server auth. |
| **Distributed rate limiting** | `apps/api/utils/rateLimit.ts` (Redis sliding windows + penalties) | Protects the future exposed S2S endpoints. |
| **Machine surfaces already exposed** | Torznab (`/api/torznab`), RSS (`/api/rss`) | Prior art for machine-readable catalogue serialisation. |
| **Reference cron plugin** | `apps/api/plugins/bonus-collector.ts` (cross-replica lock + persisted last tick) | The exact pattern for the federated sync worker. |
| **Notification fan-out** | `apps/api/utils/notify.ts` | Reusable to notify the owner of an inbound federation request. |

### 3.2 What is missing (to build)

- No notion of **origin/source** on entities (no `origin_instance`).
- No **server-to-server communication**, and no **inbound** endpoint meant for another machine (everything is outbound / pull-only).
- No **instance identity** and no **global user identity** (`passkey` and `username` are scoped per instance).
- No **asymmetric request signing** (only a shared `ADMIN_API_KEY` secret exists).

---

## 4. Guiding principles

1. **Owner opt-in, OFF by default.** `federation_enabled = false` on install.
2. **Explicit allow-list.** No unknown instance can read or push anything. No automatic discovery, no transitive trust ("a friend of a friend" is not a friend).
3. **Double consent.** A link is `active` only once both owners have approved it.
4. **Granular, asymmetric scopes.** For each peer the owner separately chooses what they *share with* it and what they *accept from* it, among `catalog` / `social` / `accounts` / `swarm`.
5. **Revocable and auditable at any time.** Cutting a link purges the cached remote data and invalidates the keys.
6. **The tracker (hot path) stays untouched** until Phase 4. Federation lives in `apps/api`, never in the critical announce path.
7. **Privacy by design.** We never federate raw PII: no IPs (already hashed), no auth verifier, no email. See §8.

---

## 5. Target architecture

### 5.1 Overview

Federation is a **new sub-system inside `apps/api`**: a group of inbound S2S routes, a group of admin routes, and a sync cron plugin. The Go tracker is untouched before Phase 4.

```
   Instance A (tracker.a.com)                         Instance B (tracker.b.com)
   ┌──────────────────────────────┐                  ┌──────────────────────────────┐
   │ apps/api (Nitro)             │   HTTPS + sig    │ apps/api (Nitro)             │
   │  /api/federation/*      ◄────┼─── Ed25519 ──────┼──►  /api/federation/*        │
   │    handshake · sync · search │  (S2S, allow-    │     handshake · sync · search│
   │                              │   listed peers   │                              │
   │  /api/admin/federation/*     │   only)          │  /api/admin/federation/*     │
   │    owner: toggle + peers     │                  │    owner: toggle + peers     │
   │                              │                  │                              │
   │  plugin: federation-sync     │                  │  plugin: federation-sync     │
   │    (cron pull, modelled on   │                  │    (cron pull)               │
   │     bonus-collector)         │                  │                              │
   └───────────┬──────────────────┘                  └───────────┬──────────────────┘
               ▼                                                  ▼
   Postgres: federation_config (singleton)            Postgres (same tables)
             federation_peers (allow-list)
             remote_torrents (catalogue cache)
             federation_sync_state (cursors)
             remote_* (social, phase 2+)
   Redis:    sync locks, S2S rate limit,
             remote response cache
```

Every outbound call goes through `safeFetch`. Every inbound call is signed, checked against the allow-list, and rate-limited.

### 5.2 Instance identity

Each instance generates **one Ed25519 keypair** the first time federation starts (stored encrypted, like the notification channel secrets). The **`instance_id`** is the fingerprint of the public key (e.g. `b32(sha256(pubkey))`). That `instance_id` plus the public key form the instance's verifiable identity — no PKI, no central authority.

### 5.3 Trust model & handshake (double opt-in)

```
 Owner A                Instance A                 Instance B               Owner B
   │  adds B's URL           │                          │                       │
   │  + proposed scopes      │                          │                       │
   ├────────────────────────►│                          │                       │
   │                         │  POST /api/federation/   │                       │
   │                         │   handshake  (A-signed)  │                       │
   │                         ├─────────────────────────►│                       │
   │                         │                          │  creates pending_in   │
   │                         │                          │  notifies the owner   │
   │                         │                          ├──────────────────────►│
   │                         │                          │                       │ approves
   │                         │                          │◄──────────────────────┤ + scopes
   │                         │  B-signed callback       │                       │
   │                         │◄─────────────────────────┤                       │
   │  link ACTIVE both sides │  (public keys exchanged) │                       │
```

- A → `POST https://B/api/federation/handshake`, **signed with A's private key**, carrying: A's `instance_id`, its public key, its public URL, its name, and the proposed scopes.
- B creates a `federation_peers` row in `pending_in` and **notifies its owner** (`notify`).
- B's owner approves in `/admin/federation`, picks their scopes → B replies (signed callback) with its public key and the scopes it accepts.
- Both sides move to `active`. Each now knows the other's public key.

### 5.4 S2S transport protocol

An **HTTP Signatures** model (inspired by ActivityPub but without its vocabulary):

- Headers: `Date`, `Digest` (SHA-256 of the body), `Signature` (Ed25519 over `(request-target) host date digest`), `X-Trackarr-Instance` (= the sender's `instance_id`, used as the `keyId`).
- Receiver-side verification: (1) the `instance_id` is in the allow-list and `active`; (2) the signature is valid for its known public key; (3) `Date` within a ±5 min window (replay protection) plus a cache of recent `Digest` values.
- Shared JSON envelope: `{ v, instance_id, sent_at, type, payload }`.
- Transport: HTTPS only, through `safeFetch` (anti-SSRF), short timeouts, mandatory pagination.

This choice avoids any shared secret to keep in sync and makes each message **non-repudiable** and **revocable** (forgetting the public key is enough).

---

## 6. Database schema

Drizzle / `snake_case` style, consistent with `packages/db/src/schema.ts`. Tables introduced per phase.

### Phase 0 — trust & transport

```
federation_config         (singleton, id = 'singleton')
  enabled                 boolean   default false
  instance_name           text
  instance_public_url     text
  signing_private_key     text      -- Ed25519 private key, encrypted (cf. notificationChannels)
  signing_public_key      text
  instance_id             text      -- fingerprint of the public key
  share_catalog           boolean   default false   -- defaults proposed to new peers
  share_social            boolean   default false
  share_accounts          boolean   default false
  share_swarm             boolean   default false
  created_at, updated_at  timestamp

federation_peers          (the allow-list)
  id                      uuid pk
  base_url                text unique          -- https://tracker.example.com
  instance_id             text                 -- remote identity (public key fingerprint)
  public_key              text                 -- the peer's Ed25519 public key
  display_name            text
  status                  text   -- pending_out | pending_in | active | suspended | blocked | revoked
  shares_with_them        jsonb  -- { catalog, social, accounts, swarm }: what we send THEM
  accepts_from_them       jsonb  -- { catalog, social, accounts, swarm }: what we accept FROM them
  last_handshake_at       timestamp
  last_seen_at            timestamp
  last_error              text
  created_by              uuid -> users.id
  created_at, updated_at  timestamp
  index(status), index(instance_id)

federation_sync_state     (cursor per peer × resource)
  peer_id                 uuid -> federation_peers.id
  resource                text   -- catalog | social | ...
  cursor                  text   -- opaque timestamp returned by the peer
  last_run_at             timestamp
  last_status             text   -- ok | error | partial
  items_synced            integer
  pk(peer_id, resource)
```

### Phase 1 — catalogue (local cache of remote content)

```
remote_torrents
  id                      uuid pk              -- local mirror id
  peer_id                 uuid -> federation_peers.id
  remote_id               text                 -- the torrent's uuid on the peer
  info_hash               text
  content_signature       text
  name                    text
  size                    bigint
  description             text
  category_slug           text                 -- mapped to a local category when possible
  tags                    jsonb
  imdb_id, tmdb_id, ...   text
  seeders, leechers, completed  integer        -- remote stats, best effort
  uploader_name           text                 -- remote name, NEVER a local id
  remote_detail_url       text
  remote_download_url     text
  fetched_at, updated_at  timestamp
  unique(peer_id, remote_id)
  index(info_hash), index(content_signature), index(imdb_id), ...
```

> The remote catalogue is a **read-only cache**, never mixed into the local `torrents` table. Federated views do the `UNION`/merge at read time (a "from instance X" badge), which keeps the local economy (ratio, HnR, moderation) completely sealed.

### Phases 2-4 (sketch, detailed below)

- **Social**: `remote_comments`, `remote_forum_topics/posts`, or one polymorphic `remote_objects(peer_id, kind, remote_id, payload jsonb, ...)` table.
- **Accounts/reputation**: `federated_identities(user_id, peer_id, remote_handle, verified_at)`, `remote_user_reputation(...)`.
- **Swarm**: no table — cross-announce at the Go tracker + Redis level (see §7.4).

---

## 7. The four axes in detail

### 7.1 Axis 1 — Catalogue / metadata *(foundation, low risk)*

**Goal.** Discover and search partner instances' content without touching the swarms.

- **Pull synchronisation**: the `federation-sync` cron plugin periodically calls `GET /api/federation/catalog?since=<cursor>` on every `active` peer that shares `catalog` with us. Paginated, signed response. Upsert into `remote_torrents`. (Optional later: a "live" push of new items over a signed webhook to cut latency.)
- **Deduplication**: the same content present locally *and* remotely is matched by `info_hash` → else `content_signature` → else media IDs. The UI shows "also available on 2 instances".
- **Federated search**: listings gain a `Local / Federated / All` filter. Two modes: *cache* (fast, reads `remote_torrents`) and *live* (fan-out `GET /api/federation/search?q=` to the peers, aggregated, time-bounded — reuses the concurrency-capped fan-out pattern from follows).
- **Download — an important decision.** In Phase 1, the "download" button on a remote torrent **redirects to the origin instance** (the user needs an account there). We do **not** serve the `.torrent` with our own passkey: that would mix the swarms and bypass the private model. Actually merging swarms is the (risky) subject of Phase 4.

**Privacy**: we federate only metadata that is already "public" within the origin instance; never the binary `torrent_data`, never the uploader's real identity (a display name only).

### 7.2 Axis 2 — Social *(medium risk)*

**Goal.** Comments, forum topics and follows visible from one instance to another, fediverse-lite style.

- Reuses the S2S transport and the `remote_objects` model. A remote comment renders read-only with a "@alice@tracker.b.com" attribution.
- **Cross-instance follows**: a local user can follow a remote user; `followed_user_upload` notifications travel over a signed S2S `Announce` message.
- **Moderation**: every remote object is locally filterable/blockable; an owner can cut a peer's `social` scope without cutting `catalog`. No remote moderation is imposed (sovereignty).
- **Anti-abuse**: per-peer rate limit, bounded payload size, HTML sanitisation identical to local input (the project already has a hardened BBCode/description viewer).

### 7.3 Axis 3 — Accounts / reputation *(high risk)*

**Goal.** Portable identity and/or reputation (ratio, bonus, seniority) between instances.

This is the most delicate axis because it touches the economy and account security. Three options, from least to most integrated:

| Option | Description | Implication |
|---|---|---|
| **A. Linked identity (recommended to start)** | A user proves they own an account on the peer (signed challenge) and **links** both identities. Shows a "verified on tracker.b.com" badge. | No economy merge. Safe. A basis for the rest. |
| **B. Imported reputation (read-only)** | On request we import ratio/seniority/bonus from the peer as a **display signal** (e.g. invitation fast-track), without altering the local economy. | Cheating risk if a peer lies → reserved for high-trust peers; values labelled "source: tracker.b.com". |
| **C. SSO / single account** | A login on one instance is valid on the other. | Very intrusive, heavy security work (revocation, panic mode, distributed ZK auth). **Out of reasonable scope for v1.** |

**Recommendation**: ship **A**, expose **B** as an explicitly "high trust" per-peer option, and **do not** do **C** in v1. The current zero-knowledge auth (the server never sees the password) makes SSO complex — good for security, but it closes the door on naive SSO.

### 7.4 Axis 4 — Swarm / peers *(VERY high risk — warning)*

**Goal.** Pool seeders and leechers between instances to speed up downloads.

⚠️ **Fundamental tension.** A private tracker *deliberately* isolates swarms (`info.private=1`, peer discovery through the tracker only). Federating peers means **piercing that isolation**. Consequences to weigh explicitly with the owner:

- **Ratio/HnR accounting**: if a peer from B downloads on A's swarm, *who* accounts for the upload/download? The ratio and Hit-and-Run model has to be rethought (cross-instance reconciliation, or a "neutral zone" that is not accounted).
- **Security/anti-cheat**: the Go tracker's anti-cheat heuristics (velocity, empty swarm, unknown peer_id) assume a closed swarm. Remote peers blur those signals.
- **Confidentiality**: exposing one instance's peers (even hashed IPs) to another widens the surface.
- **Hot-path load**: this is the **only** phase that touches the Go tracker; it must stay optional and enable cross-announce only for torrents explicitly marked "federated" and peers with a mutual `swarm` scope.

**Recommended cautious approach**: cross-announce **opt-in per torrent and per peer**, with a dedicated (or non-accounted) accounting zone, behind a `TRACKER_FEDERATION_SWARM=false` tracker flag by default. To be tackled **last**, after experience from phases 1-3. A gentler alternative: merely **display** the remote seeder count (already covered by Axis 1) without actually merging the swarms — often 80% of the perceived value for 5% of the risk.

---

## 8. Security, abuse & privacy

| Topic | Measure |
|---|---|
| **S2S auth** | Ed25519 signature per request, `instance_id` = `keyId`, mandatory allow-list, replay protection (Date + Digest cache). |
| **SSRF** | All outbound calls through `safeFetch` (already hardened: blocks private/loopback/link-local/metadata IPs, revalidates redirects). Peer URL validated at handshake. |
| **Rate limiting** | Reuses `rateLimit.ts`: windows per `instance_id` *and* per IP, escalating penalties. S2S endpoints capped. |
| **Revocation** | Moving a peer to `blocked`/`revoked` forgets its public key (its future requests fail verification) and purges `remote_*`. |
| **Panic mode** | Federation must be **suspended** while panic mode is active (no exfiltration during an incident). The signing keys fall inside the panic encryption perimeter. |
| **Privacy / GDPR** | We never federate: raw IPs (already hashed locally, **not** shared), emails, `auth_verifier`/`auth_salt`, `panic_password_hash`, `totp_secret`, recovery codes. Only content metadata and public display names. The `accounts` scope requires the **explicit consent of the user** concerned, not just the owner's. |
| **Catalogue poisoning** | Remote data is marked as such, never merged into `torrents`, filterable/purgeable per peer; a malicious peer can only pollute its own `remote_torrents` namespace. |

---

## 9. Impact on the existing system

- **Migrations**: additive only (new tables). No column removed. Compatible with the `drizzle-kit push --force` at API boot.
- **Go tracker**: **untouched** in phases 0-3. Only affected in phase 4 (cross-announce, behind an off-by-default flag).
- **Performance**: the sync is a bounded cron (the `bonus-collector` pattern), outside the user request path. "Live" federated views are capped in time and fan-out.
- **Deployment**: one new secret (`FEDERATION_SIGNING_KEY`, or auto-generated on first run); the port and Caddy need no change (S2S routes go through `/api/federation/*` behind the existing reverse proxy). Document in `doc/reference/env.md`.
- **Static build (CSR)**: the federation admin page follows the same path as the other `/admin/*` pages; no impact on the `scratch` tracker image.

---

## 10. Phasing & effort estimate

| Phase | Content | Rough effort | Depends on |
|---|---|---|---|
| **0 — Foundation** | Ed25519 keys, `federation_config`/`federation_peers`, double opt-in handshake, signed transport, admin page (toggle + allow-list), owner notification | M | — |
| **1 — Catalogue** | `remote_torrents`, `catalog`/`search` endpoints, sync cron, dedup, federated listing UI + download redirect | M–L | 0 |
| **2 — Social** | `remote_objects`, federated comments/forum/follows, per-scope moderation | M | 0, 1 |
| **3 — Accounts** | Option A (linked identity); option B (read-only reputation, per peer) | M–L | 0 |
| **4 — Swarm** | Opt-in cross-announce (Go tracker), ratio/HnR reconciliation, off-by-default flag | **L–XL** | 0, 1, field experience |

Recommendation: **0 → 1** first (the foundation plus catalogue discovery covers most of the value), then 2 and 3 depending on usage, and 4 only after an explicit decision that accepts the trade-offs in §7.4.

---

## 11. Risks & open questions

1. **Category/tag mapping** between instances with different taxonomies: plan a correspondence table or an "unclassified" fallback.
2. **Protocol versioning**: a `v` field in the envelope; capability negotiation at handshake (which phases each peer supports).
3. **Remote stat consistency**: federated seeders/leechers are best effort (short TTL); do not present them as real time.
4. **Storage quotas** for the `remote_torrents` cache (LRU/TTL purge per peer).
5. **Governance**: what happens if a trusted peer is compromised? → fast revocation + purge; consider a shareable but **non-binding** "distrust list" (each owner stays sovereign).
6. **Phase 4**: the cross-instance ratio accounting model — a design topic in its own right.

---

## 12. Mockups

High-fidelity mockups (standalone HTML reproducing the Trackarr design system) in [`./mockups/`](./mockups/). Entry point: **`mockups/index.html`** (open in a browser).

- `index.html` — landing page / navigation between the mockups.
- `admin-federation.html` — the `/admin/federation` page: owner master toggle, verifiable instance identity, default shared scopes (catalogue · social · accounts · swarm), KPIs, peer allow-list (statuses, scopes, sync, add/handshake). **The approval modal for an inbound request is included** (the *Review* button on the pending request).
- `federated-catalog.html` — listing with a Local/Federated/All filter, an origin badge ("via …"), cross-instance dedup, download by redirect to the source.
- `styles.css` — shared stylesheet reproducing the live design system tokens.

---

*Design document — to be approved before any implementation.*
