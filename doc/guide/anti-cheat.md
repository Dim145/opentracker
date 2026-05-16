# Anti-cheat

The tracker watches every announce for signatures of common
ratio-cheating tools (RatioMaster, rustatio, …) and persists
suspicious events to a moderation queue at `/mod/anti-cheat`.
**Nothing is ever auto-banned** — the queue is a triage surface,
not an enforcement engine. Moderators review each flag and
decide whether to issue a warning, monitor, or ban manually.

## What gets flagged

Three independent detectors run inside the Go tracker on every
announce. Each one persists a row to `anticheat_flags` when it
fires; many suspicious announces produce multiple rows.

### Velocity

A peer claims an upload rate that's physically impossible. The
detector compares the upload delta since the previous announce
against an operator-set ceiling (default **80 MB/s**, the
realistic upper bound of a gigabit symmetric line):

```
delta_uploaded / elapsed_seconds > MaxUploadBytesPerSecond
```

Severity scales with how far over the cap the announce is:
- `low`  — 1×–2× the cap
- `medium` — 2×–5× the cap
- `high`  — >5× the cap

A velocity flag is the strongest single signal — manual cheaters
rarely fake bandwidth in a way that doesn't trip this.

### Empty-swarm upload

The peer reports an upload delta but the swarm has **zero
leechers** at announce time. There's literally no one to upload
to; the bytes can only be fabricated. Severity always `high`.

The detector subtracts the announcing peer's own state from the
pre-update swarm counters so a self-announce isn't counted as
"the leecher". The flag fires only when the real swarm-minus-
self leecher count is zero AND the delta is positive.

### Unknown client signature

The `peer_id` prefix doesn't match the BEP 20 whitelist of
about 80 mainstream BitTorrent clients (qBittorrent,
Transmission, Deluge, libtorrent-rasterbar, BitTorrent Mainline,
…) AND the `User-Agent` header doesn't look like one of the
real clients either. Only fires when there's actual upload
delta — pure leechers with custom clients don't get tagged.

Severity is always `medium`. Some legitimate niche clients
(developer builds, very old releases) trip this too, so the
detector errs on the lighter side — a moderator reviewing the
case can distinguish a curious user from a hand-rolled cheater
via the peer_id / UA / behaviour combo.

## The moderation queue

`/mod/anti-cheat` lays the flags out as a "radar console":

- **Top strip**: pulse indicator + KPI tiles (unreviewed total,
  per-kind counts, reviewed count). Tiles are clickable
  filters.
- **Feed**: each flag is a numbered case (`№ XXXX`) with a
  severity ribbon (width scales with severity), a kind chip,
  an evidence summary (e.g. `147 MB/s claimed · 80 MB/s
  allowed`), a hash-gradient suspect avatar, the target
  torrent, and the time + verdict.
- **Inline detail**: click a case to expand the evidence
  panel — peer_id, IP, User-Agent, raw JSON payload, and the
  review form.

Cases under 5 minutes old get a pulsing inner border in the
kind tone, so a wave of fresh flags during a live incident is
visible at a glance.

## Reviewing a flag

When a moderator commits a verdict, the row is stamped with
`reviewedAt`, `reviewedById`, `reviewVerdict`, and an optional
`reviewNote`. Hitting the endpoint twice on the same flag
rotates the reviewer and re-stamps the timestamp — useful for
revisiting a decision.

The four primary verdict buttons cover the main outcomes:

| Verdict | When to use |
| --- | --- |
| **Clean** | False positive — legitimate client tripping the unknown-signature heuristic, or a velocity flag from a misconfigured detector. |
| **Warned** | First-offence pattern; staff messaged the user. |
| **Banned** | Decision to ban — issue the ban from the user admin page, then mark the flag here for the audit trail. |
| **Monitoring** | Inconclusive; keep watching the same user / torrent. |

The verdict text is free-form — buttons are presets but any
short label (up to 40 chars) is accepted, so a team can adopt
its own vocabulary.

A `reviewNote` (up to 500 chars) travels with the verdict so
the next moderator landing on the same suspect's row sees why
their predecessor closed it.

## Data model

```
anticheat_flags
├── id               text PK
├── user_id          text → users(id)         ON DELETE CASCADE
├── torrent_id       text → torrents(id)      ON DELETE SET NULL
├── info_hash        text
├── kind             text  (velocity | no_leecher | unknown_client)
├── severity         text  (low | medium | high)
├── details          jsonb
├── peer_id          text
├── ip               text
├── user_agent       text
├── created_at       timestamp
├── reviewed_at      timestamp
├── reviewed_by_id   text → users(id)         ON DELETE SET NULL
├── review_verdict   text
└── review_note      text
```

Three supporting indexes: `(user_id, created_at)` for "all
flags on this user", `reviewed_at` (the queue scan), and `kind`
for the per-kind tiles.

## Configuration

The detector lives entirely inside the Go tracker. Defaults
match a typical private-tracker workload:

| Setting | Default | Override |
| --- | --- | --- |
| Max upload bytes/sec (velocity cap) | 80 MB/s | `ANTICHEAT_MAX_BYTES_PER_SECOND` env (bytes/sec) |
| Detection runs in goroutine | yes | hard-coded (announce hot path stays fast) |
| Detection happens **before** the 1 TiB delta clamp | yes | hard-coded (detector sees raw client claims) |

Increasing the velocity cap is the safest tuning knob if you
serve a community with symmetric 10 Gb/s connections. Lowering
it is risky — the false-positive rate climbs fast below ~50 MB/s.

## Privacy

- The IP and User-Agent stored on the flag are visible only to
  staff (`/mod/anti-cheat` requires a moderator session).
- The user's username + monogram avatar links through to the
  public profile; no PII beyond what's already public on the
  profile page is exposed.
- Anonymous announces (no passkey) cannot reach the detector —
  the tracker rejects them upstream.

## Limitations

- The detector is **statistical**, not cryptographic. A
  sophisticated cheater can spoof the peer_id, User-Agent, and
  pace their fake announces under the velocity cap to evade
  all three heuristics. The queue catches the lazy 90 %, not
  the careful 10 %.
- An empty swarm at announce time may be a transient state
  (the seeder lost their last peer two seconds ago) rather
  than a fake announce. Manual triage handles the edge cases.
- Velocity uses the **previous announce's** elapsed time. The
  first-ever announce from a user can't be tagged this way
  because there's no baseline yet.
