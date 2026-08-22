# Federation — sharing data, not just metadata

Federation (see [federation.md](./federation.md)) mirrors a partner's **catalogue**:
you see what exists elsewhere. On its own that is a dead end — you see a release
on a partner and cannot obtain it, because a private tracker's `.torrent` is not
portable (its announce URL carries the partner's address **and someone else's
passkey**). This document covers the layer that turns "I can see it" into "I can
act on it": content addressing, requesting, cross-seeding, availability, and the
credit settlement that a future content relay will need.

None of it moves bytes outside a tracker's own rules. It makes the mesh **legible**
— who wants what, what is the same content, where it is alive — and lets members
act with their own accounts.

---

## The hard constraint

Three facts frame everything:

1. **A private `.torrent` is not portable.** The announce URL binds it to one
   tracker and one member's passkey. We never relay a partner's `.torrent`.
2. **The same content has different v1 infohashes on different trackers.** Piece
   length, the `private` flag, file order — all change the `info` dict and thus the
   SHA-1. So content must be matched by **content**, not by infohash.
3. **BitTorrent moves no bytes without a seed in the destination swarm.** Federation
   can move metadata and introduce peers; the bytes flow only when someone seeds
   them in the swarm of the instance that wants them.

## The spine — BitTorrent v2 content addressing (BEP 52)

BitTorrent v2 identifies each file by the **root of a Merkle tree over its 16 KiB
blocks**. That root depends on the file's *content alone* — not the piece length,
not the private flag, not the other files. Identical files always produce identical
roots, wherever they live. That is the cross-tracker content address v1 never had.

At upload we derive, from the normalised `.torrent` we store and serve
(`utils/bittorrentV2`):

- **`info_hash_v2`** — SHA-256 of the v2 `info` dict (the v2/hybrid infohash).
- **`content_root_v2`** — SHA-256 over the sorted per-file roots. This is the
  release-level cross-tracker key, the cryptographic upgrade of `content_signature`
  (which only compared paths + sizes and could collide). Padding files are excluded;
  it is invariant to piece length and the private flag.

Both travel in the signed catalogue record (`bt:infohash_v2`,
`trackarr:contentRootV2`, per FEP-d8c8) and are mirrored from partners. Torrents
uploaded before this existed are backfilled from their stored `.torrent`
(`plugins/backfill-content-roots`). A v1-only torrent has neither and falls back to
`content_signature`.

> **Match key, not swarm key.** `content_root_v2` proves two files are the same
> content. It does **not** make two swarms joinable — that needs a shared *infohash*
> (v1 or v2), which the same content only has at the same piece layout. Keep the two
> ideas separate; the availability signal below leans on this.

## M1 — Request here (request → fill)

The bridge that closes "I see it, so I can get it here" for the **majority** of
members (those on a single tracker).

On a mirrored release's page, **Request here** raises a normal
[upload request](./upload-requests.md) on *this* tracker, pre-filled from the mirror
(title; category via the [federated taxonomy mapping](../integrations/torznab.md),
then by type). A local member who has the content — through their own partner
account, a seedbox, anywhere — fills it by uploading here, earning their ratio and
any reward on this tracker. No bytes cross a tracker outside its rules.

Two things ride along:

- **Targeted notification.** The members who have a *proven account on that partner*
  (federated identity links) are notified first — they are the most likely to hold
  it.
- **Content-verified signal.** If the request and the filling upload have an equal
  `content_root_v2`, the request page shows a **content-verified** badge — proof it is
  the same content. This is advisory, not a gate: an *unequal* root does not prove a
  different release (the key spans `.nfo`/subs/sample files, which honestly differ),
  and the requester validates by hand exactly as for a v1-only release.

## M2 — Cross-seed on partners

For the **minority** on both trackers. A release you already seed here may be
content a partner carries too; cross-seeding it from the bytes on your disk helps
swarm health and ratio on both sides for free.

The torrent page's **Cross-seed on partners** section lists partner releases that
are the same content (matched by `content_root_v2`, `content_signature` as a hint),
each badged `verified` (v2) or `likely` (signature). The link goes to the partner's
page — **you fetch the `.torrent` there, with your own passkey.** Federation supplies
the match, never the file.

## M3 — Mesh availability (a signal, not a bridge)

The same section shows an **"N seeders across the mesh"** figure: the total
seeders/leechers of the content-equivalent releases across partners.

This is deliberately a *signal*, not peer injection. Because a swarm is joinable only
by shared infohash (see the spine note), injecting a partner's peers "matched by
content root" would just yield failed handshakes when the piece layouts differ — and
the existing swarm cross-announce ([federation.md, Axis 4](./federation.md#axis-4--swarm))
already borrows a partner's peers whenever the `.torrent` is genuinely identical. So
M3 tells you the content is alive across the mesh — worth cross-seeding — and nothing
more.

## Inter-instance credit (settlement for a future relay)

When one instance serves another's members, the serving side spends bandwidth while
those members leech "for free" against local ratio. Left there, a partner is a ratio
sink. The credit model is the settlement layer that fixes it, ready for a content
relay (webseed, "M4") that does not exist yet.

It exchanges **signed contribution attestations**: the instance that *was served*
signs "your member (DID) contributed N bytes", sends it over the `accounts` channel,
and the member's own instance verifies the signature and credits their **bonus
upload** (never real upload). Honouring it is:

- **Off by default** (`federation_credit_enabled`) — trusting a partner's word about
  what its users pulled is the operator's call.
- **Signature-bound** — the attestation must be signed by the sending peer's key.
- **Idempotent** — the ledger row id *is* the attestation's content address, so a
  replay credits nothing.
- **Capped** — bytes credited per member per rolling day are clamped
  (`federation_credit_daily_cap_bytes`), under a row lock so concurrent attestations
  cannot race past the ceiling.

What a webseed relay still needs on top: the *data source* (per-member bytes actually
served — a capability token attributes that cleanly), and an explicit risk decision
(bandwidth, legal exposure, ratio). Until then the settlement layer stands, tested,
doing nothing on its own.

## Configuration

| Setting | Default | Effect |
|---|---|---|
| per-torrent `federate_swarm` | off | Opt a torrent into swarm cross-announce (Axis 4). |
| `federation_credit_enabled` | off | Honour partner contribution attestations. |
| `federation_credit_daily_cap_bytes` | 50 GiB | Max bonus upload credited per member per day. |
| `torznab_include_federated` | off | Fold federated releases into Torznab/RSS (magnet, discovery). |

All off by default: the mesh reads before it writes, and nothing touches ratio or a
machine feed until an operator opts in.

## Honest limits

- Federation never hands out a partner's `.torrent`, and never a joinable swarm the
  content does not already share by infohash.
- `content_root_v2` is a *match* key; two matched releases with different piece
  layouts are the same content but distinct swarms.
- The credit model is settlement only until a content relay feeds it real byte counts.
- Everything member-facing is gated by moderation, masking and the same anonymity
  rules as the local catalogue.
