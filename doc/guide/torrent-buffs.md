# Per-torrent bonus buffs

Multipliers and pinning applied to **one release** rather than to the whole
site. Staff set them from the torrent's own page, under **Staff tools**.

## What they are

| Field | Meaning |
| --- | --- |
| Download multiplier | `0` freeleech, `50` silverleech, `100` normal |
| Upload multiplier | `100` normal, `200` double credit, up to `1000` |
| Ends | When the buff lapses. Empty means "until somebody changes it" |
| Pinned | Lifts the release to the top of listings. Costs nothing, changes nothing about the economy |

Basis points ×100 — the same units `bonus_events` uses, so the project has one
unit system rather than two.

## How a buff meets a site-wide event

**The member gets the better of the two, on each axis independently.** Never the
product.

| Site-wide | This torrent | Member pays / earns |
| --- | --- | --- |
| nothing | freeleech | download 0, upload ×1 |
| freeleech | nothing | download 0, upload ×1 |
| freeleech | double upload | download 0, upload **×2** |
| freeleech ×2 upload | nothing | download 0, upload ×2 |

The product is what a reader first expects, and it is wrong in practice: a
site-wide freeleech multiplied by a torrent-level double-upload would give
upload ×4 — credit nobody granted. Taking the better of each axis keeps every
buff meaning what its operator set it to, and guarantees a useful property: a
buff can only ever *help* a member relative to the site-wide state. An operator
granting a freeleech never has to check what else is running first.

The rule lives in two places by necessity — `apps/tracker/internal/bonus.Best`
for the announce path and `apps/api/utils/torrentBuffs` for the feed — and both
sides assert the same table of cases in their tests.

## Two powers, two gates

- **Pinning** is any moderator's call. It moves a release up a page.
- **The multipliers** require an **admin**. They mint upload credit out of
  nothing, which is an economic act rather than an editorial one.

Both land in the [staff audit log](./audit-log.md) with the before and after
values, since they are mutating calls under `/api/mod/`.

## Expiry needs no sweep

A lapsed buff is neutralised **in the announce query itself**:

```sql
CASE WHEN multipliers_until IS NULL OR multipliers_until > now()
     THEN download_multiplier ELSE 100 END
```

So a buff ends the moment its timestamp passes, whether or not any job noticed,
and the hot path carries no clock logic. Setting an end date in the past is
refused rather than silently accepted — the way to end a buff now is to reset
the multipliers to 100.

The values ride along on the row the announce path already had to read, so a
buffed torrent costs exactly as much to announce as an unbuffed one.

## Where a member sees it

- A badge on the torrent page — **Freeleech**, **Silverleech**, **Double
  upload** or **Boosted** — with its end date when it has one. Deliberately
  blind to site-wide events: a badge on one torrent among a hundred has to mean
  *that* one.
- The Torznab feed's `downloadvolumefactor` / `uploadvolumefactor`, per item.
  Two releases in one response can now legitimately differ, which is the whole
  point and was impossible while those were one pair of numbers for the page.

## Pinning and the listing

Pinned releases are lifted **out of the flow on every page** and returned as a
separate block on page one, under the same filters as the listing.

Not folded into the `ORDER BY`, which is the obvious implementation and the
wrong one: `is_sticky DESC` in front of the sort key stops every existing
single-column index from serving it, so a catalogue that sorted off an index
starts doing a full sort on every page. Held out on every page rather than only
on page one so a release appears exactly once and the page count describes what
can actually be scrolled through.

Capped at five. A first screen that is all pins is a page with no listing on it;
an operator who wants ten things at the top wants a homepage block.
