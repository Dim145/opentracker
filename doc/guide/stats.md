# Site statistics

**/stats** is the site looking at itself: what the catalogue is made of, how the
site got here, what everybody is grabbing, and what a year of it was. Available
to every member.

Before it existed, all of this was in the database and visible only to
administrators — a member saw four counters on the homepage and nothing else.

## What is on it

- **Right now** — releases, members, seeders, snatches and traffic since the
  beginning. The releases and members figures each carry the change over the
  window shown below them, so the page answers "is the site growing" without
  scrolling to a chart.
- **How it got here** — releases and members over 30, 90 or 365 days, plus
  traffic per day across the full width. Each chart labels the top and bottom of
  its own scale: the two cumulative series are anchored at their minimum, not at
  zero, because the slope is the story, and an unlabelled min-anchored axis is
  the oldest way to overstate growth. Above 120 points the traffic bars are
  summed into weeks — 365 bars in the space available cannot be read — and the
  axis says `per week` when that happens. The collapsed table under each chart
  always carries every point.
- **What is in the catalogue** — releases and bytes per category. Each bar is the
  category's **share of the catalogue**, so two categories can be compared by
  eye.
- **Most snatched** and **biggest swarms** — ten releases each, with size and
  count in named columns. Both are **all time**: the window switcher above
  governs the history panel only, which is why their titles say so.
- **Who is filling the catalogue** — the ten members with the most live releases.
- **The year in review** — one year at a time, with a monthly breakdown, the
  busiest categories and releases, and the busiest single day.
- **Your year** — your own uploads, snatches, bytes, seed time and bonus, as a
  section of its own at the same weight as the rest of the page.

## What is deliberately not on it

**No per-member volume.** No ratio board, no "top uploaders by terabyte". Those
are the numbers a tracker leaderboard is traditionally built on, and there is no
setting on this site by which a member could decline to appear in one — so
publishing it would publish, for every member, a figure they never agreed to
publish. The uploader board ranks by **number of live releases**, which is
already visible on each member's profile, so counting them discloses nothing new.

**No member who uploads anonymously.** `Settings → Privacy → anonymous uploads`
conceals a name on every surface that attributes a release. A board naming them
would be the one surface that undoes it, so they are left out of the board and
still counted in the totals.

**No adult release** for a member who has not opted in, in any list that names a
release.

## Two figures that are not the same

`Releases added` and its byte figure are properties of the catalogue: the size of
what was catalogued in the year. They are exact.

`Traffic` is how much actually moved, taken as the difference between the first
and last hourly snapshot inside the window. It is **a floor, not a total**: the
counter behind it is `SUM(users.uploaded)`, which drops when an account is erased
or a moderator resets a cheater's stats. The page says so under the figure.

For the same reason, a per-day figure is clamped at zero rather than shown
negative — a chart reporting "-4.2 TB on Tuesday" would be a number a reader
would try to explain.

**Your own download figures follow your privacy setting.** With
`Settings → Privacy → hide download history` on, the grabs, bytes and seed time
are withheld from your year — the same door that closes `/downloads`, since a
stolen session must not be able to read them either. Your uploads still show.

## Where the numbers come from

| Section | Source |
| --- | --- |
| Right now | `torrents`, `torrent_stats`, `users`, latest `site_stats` |
| History | `site_stats`, one snapshot an hour |
| Categories | `torrents` joined `categories` |
| Rankings | `torrent_stats.completed` / `.seeders` |
| Snatches in a year | `hnr_tracking`, counting rows with a **completion** date — a row appears when a member downloads the `.torrent`, so counting rows would count metainfo downloads rather than completions |
| Your year | your own rows in the four tables above, plus `bonus_grants` |

A day with no snapshot is absent from the charts rather than drawn as zero: an
instance that was down for six hours must not draw a cliff on a counter that
never moved. For the same reason a per-day figure is **skipped** across a gap
rather than attributed to the day the snapshots resumed — otherwise the day after
the longest outage is reported as the busiest of the year, every time.

The day a snapshot belongs to is decided by Postgres, not by the API process, so
the labels are UTC dates regardless of the container's `TZ`. Under each chart, **Show the numbers** opens the same values as a
table — the picture is not the data.

## Years, and time zones

A year runs from 1 January to 1 January **in UTC**. The members of one tracker
are spread across every time zone, so a year anchored on the server's own offset
would be an arbitrary choice presented as a fact.

The year selector only offers years the instance has snapshots for. A review of a
year the site did not exist for would be an empty page, which reads as broken
rather than as empty.

## Caching

The site view is cached for a minute, per window and per adult-visibility. A past
year is cached for a day, since it cannot change; the current year for a minute.
Your own year is not cached at all — a member who has just uploaded something
should see it.
