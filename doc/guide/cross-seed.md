# Cross-seed

Surface sibling torrents — different `.torrent` files that pack
the **same underlying content** — on the detail page so users
can find every seedable copy of a release in one place. The
KPIs next to seeders / leechers / size answer "how much of this
swarm is also active on a sibling?"

## Content signatures

Cross-seeding works because two torrents can share the exact
same file layout but differ in piece size, tracker URL, or
metadata. A SHA-256 of the normalised file list — relative
paths + sizes, sorted — gives both torrents the same
**content signature** even though their infoHashes differ.

The signature is computed once at upload time (`apps/api`
populates `torrents.content_signature` during the .torrent
parse) and indexed for the listing query. Existing rows are
back-filled by an idempotent plugin on first boot after the
schema migration; the operator doesn't have to run anything by
hand.

## Sibling detection

On `/torrents/:hash`, a **Cross-seeds** section appears
whenever the torrent has at least one sibling. Each sibling
gets a row with:

- Its category + name (the release-group differs across cross-
  seeds even though the bytes match).
- Live seeder / leecher counts.
- A link to its own detail page.

The query is bounded at 50 siblings — the cap protects against
runaway scans on a hot release that's been ripped by dozens of
groups.

## KPIs on the detail page

Next to the regular seeder / leecher / size tiles, two
cross-seed tiles surface aggregate metrics:

| KPI | Meaning |
| --- | --- |
| **Cross-seed peers** | Count of peers in the current swarm who are ALSO active on at least one sibling right now. Split into seeders + leechers. |
| **Cross-seed volume share** | Bytes uploaded on this torrent by users who have peer activity on a sibling, divided by total bytes uploaded on this torrent. |

The "share" KPI is the more interesting signal — it tells a
user how much of the bandwidth this torrent gets comes from
people who could just as well be seeding a sibling. A high
share (>50 %) means switching to a sibling is low-risk for the
swarm health.

Both KPIs are memoised in Redis for 30 seconds. The compute
cost is non-trivial (a fan-out of up to 50 sibling-swarm
HGETALLs plus two SQL aggregates), so the short TTL keeps the
endpoint cheap under repeated page reloads without making the
numbers visibly stale.

## Privacy / moderation

- Siblings inherit the regular moderation gate: pending /
  rejected / changes_requested torrents are visible only to
  their own uploader or to staff. A foreign viewer hitting the
  detail page never sees an unapproved sibling.
- The peer-set comparison is anonymised — the API returns
  counts, not the per-user list of "who's cross-seeding". The
  underlying `getPeers` already projects only the hashed IP
  for non-staff callers.

## Schema

`torrents.content_signature` is a `text` column carrying the
SHA-256 hex digest of the normalised file list (or NULL for
torrents uploaded before the signature backfill completed).
Plain B-tree index on the column drives the sibling-lookup
query — `WHERE content_signature = $1 AND id != $2 LIMIT 50`.

## Limitations

- Two torrents that differ in encoding / quality but happen to
  have the same file names + sizes (rare for media files of
  meaningful length) would still be tagged siblings. Practical
  collisions are negligible.
- A repack with the same total file list but a different
  internal piece size shares a signature — they're genuinely
  cross-seedable, so this is intentional, not a bug.
- The 50-sibling cap is a hard limit. A release with 60
  independent rips shows the top 50 by `created_at` desc; the
  remaining 10 are invisible to the KPI even though they exist
  in the listing query.
