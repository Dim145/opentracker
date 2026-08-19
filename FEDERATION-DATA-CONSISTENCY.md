# Federation — data consistency: analysis & recommendations

**Date:** 2026-06-13 · **Method:** 4 mapping agents over the real code (api + tracker + db + web), with `file:line` evidence.

## Design model (confirmed by the code)

trackarr federates **metadata and social data only**, between **sovereign instances**. The README says so explicitly: *"no SSO, economies stay isolated"*, *"ratio/HnR stay local"*. Concretely:

- **The economy is strictly local** (traffic, ratio, bonus_points, events) — verified end to end.
- **Bans are strictly local** — no S2S propagation.
- The remote catalogue lives in a **separate** `remote_torrents` table (never merged into `torrents`), with download links that **point back to the origin instance**.

Most of your six questions therefore fall under "correct by design". But the analysis did surface **3 concrete defects** and **2 UX/dedup gaps** that need a decision.

---

## Scenario 1 — Freeleech / silverleech / events and traffic accounting

**Current behaviour (sound by design).** The event multiplier and the traffic credit are **always co-located on the same instance**: the Go tracker applies the multiplier from *its own* Redis snapshot `bonus:active` (`apps/tracker/internal/bonus/bonus.go:148`, applied in `handler.go:514-522`), then credits `users.uploaded/downloaded` **by passkey** (`handler.go:541`, `users.sql.go:39-44`). A passkey only exists on the instance that issued it.

The key point: for a federated torrent (catalogue mirror), **a user of instance Y cannot announce it as a credited download on Y** — they have neither the `.torrent` nor a Y passkey for that content (`catalog.get.ts:126-131`: "a federated peer never gets our `.torrent` bytes, only a link"). They download from origin instance X, with an X account, and announce **to X's tracker** → X's freeleech applies, against X's credit.

> **Verdict: no problem.** One instance's freeleech cannot affect another's accounting. Multiplier and credit are inseparably local.

**Should events be shared?**

| Option | For | Against | Rec |
|---|---|---|---|
| **Keep local** (current) | Aligned with "economies isolated"; zero double-counting risk; each operator owns their policy | A coordinated "network-wide" event is impossible | ✅ **Keep** |
| Announce a peer's event (info only) | Shows "X is in freeleech" on the remote catalogue | Purely cosmetic; does not affect the credit (which stays on X) | Optional, low value |
| Shared freeleech crediting cross-instance | — | Would require shared identity/ratio (SSO) — against the design; opens double-counting | ❌ **Avoid** |

---

## Scenario 2 — An instance bans a user

**Current behaviour.** Strictly local: the three paths that set `is_banned` (`admin/users/[id]/ban.post.ts`, `admin/reports/[id].put.ts`, and the unban in `banExpiry.ts`) **carry no federation reference**. No table or S2S route conveys a ban. The S2S layer authenticates only the **peer instance** (`inbound.ts:91-153`), never an individual remote user.

**Real consequences (to decide on):**
- **A banned user's federated footprint persists**: the outbound paths do not filter on `isBanned`. The catalogue (`catalog.get.ts:32-85`, which exposes `uploaderName`), search (`search.get.ts:67-78`), comments (`torrent-comments.get.ts`) and the forum (`forum.get.ts`) keep serving a banned user's content. → a banned user keeps their torrents, comments and posts visible on peers.
- **Reputation laundering**: the "verified identity" badge and the reputation (ratio/volume) are **re-fetched live but without a ban filter** (`user-reputation.get.ts`), and the link is **verified once and never revalidated** (no expiry column on `federated_identities`). A cheater banned on X keeps a "healthy" reputation displayed on Y indefinitely.
- **Good news**: a linked identity confers **no authority to act** on Y (no code authorises an action through `federated_identities`) — this is not an auth bypass, only a misleading display.

| Option | For | Against | Rec |
|---|---|---|---|
| **Purely local ban** (current) | Sovereignty; no transitive trust; GDPR-friendly | Laundered reputation; a banned user's content keeps federating | Correct baseline, **but incomplete** |
| **Filter banned users on the way out** | A banned user's catalogue/search/comments stop federating | Small join cost | ✅ **Recommended** (low risk) |
| **Ban-aware reputation + liveness** | The badge/reputation reflects the origin ban; periodic revalidation | A little S2S logic | ✅ **Recommended** (anti-laundering) |
| **Ban propagation (federated moderation)** | A bad actor banned everywhere | Strong transitive trust; risk of abusive ban cascades; complex | ⚠️ Optional, **opt-in per peer** only |

---

## Scenario 3 — An IP is banned

**Current behaviour.** No federation propagation (`banned_ips` is referenced nowhere in the federation code). Local enforcement at announce time **now exists** (`handler.go:295-297` → `IsIpBanned`, added by commit `9341564` / finding L8).

> **Verdict: not a problem, and sharing is discouraged.** Sharing IP bans between independent operators means sharing users' network data across distinct organisations (a privacy/GDPR problem), and a shared IP (VPN/CGNAT) banned elsewhere would punish innocent users on your instance.

| Option | For | Against | Rec |
|---|---|---|---|
| **Local IP ban** (current) | Privacy; no imported false positives | No shared network-wide defence | ✅ **Keep** |
| Opt-in shared blocklist | Pooled anti-abuse defence | Privacy; false positives (shared NAT) | ❌ Unless a strong need, explicit opt-in |

---

## Scenario 4 — Multi-instance search and the Torznab API

**Current behaviour.**
- **Two federated search modes**: *cache* (`browse.get.ts` reads the local `remote_torrents` table, populated by the `catalogSync` cron) and *live* (`search-live.get.ts` fans out signed requests to each peer, aggregated in memory, not persisted). The inbound endpoint `search.get.ts` serves *our* local `torrents` to peers.
- **Torznab and RSS are strictly LOCAL**: `torznab/api/index.get.ts` and `rss/*` query **only** `schema.torrents` (accepted+active). `remote_torrents` is referenced in just 3 files (catalogSync, browse, remote/[id]) — **none** of them torznab/rss.
- **Downloading a federated result**: **deep-link to the origin only**. `remote_torrents` has **no** `torrentData` column — the `.torrent` bytes do not exist locally; the UI offers only an "open on source" link (`federated.vue:69-71`). No proxy, no broken local download.

> **Verdict: sound and deliberate.** Torznab being local-only means **no risk** of exposing unfetchable enclosures to the *Arr stack. Exactly the right call.

**Gaps (to decide on):**
- **No federated↔federated dedup**: if X and Y carry the same release, **2 rows** show up (cache and live). The content signature is used only to flag overlap with the *local* catalogue (`browse.get.ts:100-118`), never to merge copies across peers.
- **`remoteDownloadUrl` is dead data**: populated on every sync (`catalogSync.ts:248`) but **never read** by any consumer.

| Question | Rec |
|---|---|
| Should Torznab include federated results? | ❌ **No** — an *Arr could not grab them (no origin passkey). Keep it local-only. |
| Dedup of federated duplicates | ✅ **Yes** — group by `contentSignature`/`infoHash` across peers, show one row with multi-origin badges |
| `remoteDownloadUrl` | Decide: **use it** ("download from origin" button) or **drop it** (cleanup) |

---

## Scenario 5 — A category exists on one instance but not the other

**Current behaviour (problematic).** A **separate namespace with no mapping**: `catalogSync` stores `categorySlug` + `categoryType` as **denormalised text** on `remote_torrents` (`schema.ts:2198-2199`, `catalogSync.ts:226-227`), with **no FK** to local `categories` and **no resolution**. The schema comment at `schema.ts:2197` ("Mapped to a local category slug when possible") describes a mapping **that does not exist in the code**.

On display, on instance Y:
- The **remote category name/slug is never shown** — the UI shows only a **glyph derived from `categoryType`** (`federated.vue` / `[id].vue` via `catIcon(categoryType)`), falling back to a generic file icon when `type` is null.
- **No category filter** in the federated browse (`browse.get.ts:31-42` filters on name/infoHash/peer only).
- 🔴 **The adult gate has no federated counterpart**: `remote_torrents` has no `isAdult` flag, X's outbound path does not filter adult content, and Y's display does not check `showAdultContent`. → **adult content from one instance shows to every user of another, gate ignored.** (Versus the local path, which gates correctly: `torrents/index.get.ts:49-55`.)

| Option | For | Against | Rec |
|---|---|---|---|
| **Denormalised strings + better UI** | Simple; show the remote category name as a non-filterable badge | No cross-instance filtering or normalisation | ✅ **Short term** |
| **Mapping via Newznab id** (standard) | Categories normalised across instances (prior art: Newznab/Prowlarr); filterable | Needs a mapping table plus operator UI | ✅ **Medium term** |
| Manual slug→slug mapping per peer | Fine-grained control | Tedious; does not scale | ⚠️ Fallback |

> 🔴 **Whatever mapping is chosen: the federated adult gate is a content-policy hole that must be closed** — federate an `isAdult` flag (already known from `categories.type`/`isAdult` on the origin side) and apply it on the federated browse and detail views.

---

## Scenario 6 — Same question for tags

**Current behaviour.** Remote tags are stored as a **`jsonb` array of strings** on `remote_torrents` (`schema.ts:2200`, `catalogSync.ts:231-233`), **never** resolved to local `tags` or `torrent_tags`, and **never** re-normalised (the local `releaseTags`/`slugifyTag` path is upload-only). Display: read-only chips (`federated.vue:60` slice(0,3)). **No tag filter.**

> **Verdict: minor problem.** Tags are folksonomic by nature; a string namespace is acceptable. But two peers with different spellings (`x265` vs `HEVC`) produce strings that cannot be matched.

| Option | For | Against | Rec |
|---|---|---|---|
| **Free read-only strings** (current) | Simple; tolerant | No filtering; spelling duplicates | ✅ **Keep**, plus normalise case/facets at sync time |
| Mapping to local tags | Filterable; unified vocabulary | Information lost when nothing matches; complexity | ⚠️ Only if federated filtering becomes a requirement |

---

## Summary — recommended sharing posture per feature

| Data / function | Current | Recommendation |
|---|---|---|
| Traffic / ratio / bonus | Local | ✅ Keep local |
| Bonus events (freeleech…) | Local | ✅ Keep local (optional informational display) |
| User ban | Local, **ban-blind on the way out** | Keep local **+ filter banned users outbound + ban-aware reputation/liveness** |
| IP ban | Local | ✅ Keep local (sharing discouraged) |
| Torznab / RSS | Local-only | ✅ Keep local-only |
| Federated search | Cache + live, deep-link | ✅ OK **+ cross-peer dedup** |
| Categories | Strings, **not displayed, adult gate missing** | **Show the remote name + federate `isAdult` (gate)**; Newznab mapping in the medium term |
| Tags | Opaque strings | Keep + normalise at sync time |

## Concrete defects to fix (independent of the design choices)

1. 🔴 **Adult gate not federated** (S5) — adult content shown to everyone on the federated view. *Fix:* federate `isAdult`, gate the browse and detail views.
2. 🟠 **De-trust without purge** (S2) — `suspend`/`block`/`revoke` via PATCH **does not purge** the cache, and the serving paths (`browse.get.ts:65-73`, `me/federated-follows.get.ts`, `remote/[id].get.ts`) **do not filter on peer status** → data from a de-federated peer is served as trusted. Contradicts the schema comment at `schema.ts:2135` ("revoked → purged"). *Fix:* filter on `peer.status='active'` when serving, or purge on revoke.
3. 🟠 **Ban-blind outbound** (S2) — a banned user's catalogue/search/comments/reputation keep federating. *Fix:* an `isBanned` filter on the way out plus revalidation of linked identities.
4. 🟡 **No federated↔federated dedup** (S4) — duplicates on display. *Fix:* group by content signature/infoHash.
5. 🟡 **`remoteDownloadUrl` is dead data** (S4) — use it or drop it.

> These five points are **proposals**; none is implemented here (the scope was "analysis + recommendations"). Frontend mockups (remote category/tag display, dedup, adult gate, de-federated peer badge) follow.
