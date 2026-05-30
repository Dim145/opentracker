# Freeleech pool

A **community-funded freeleech**. Members pour their bonus points
into a shared pot from the shop; when the pot reaches its target, a
site-wide freeleech is triggered for a configured number of days.
When it ends the pool drains and a fresh cycle opens.

It complements [Bonus Events](./bonus-events.md) (operator-scheduled
windows) and the [Seed Bonus Economy](./seed-bonus.md) (where the
points come from): the pool lets the *community* decide when the next
freeleech happens by spending what they earned.

## How a cycle works

A cycle is one fill → trigger → run → drain loop, tracked by a status:

- **filling** — contributions accepted; total below target.
- **full_queued** — target reached, but a freeleech bonus event was
  already running, so the pool waits for it to end.
- **active** — the pool's own freeleech bonus event is live.
- **ended** — the freeleech ran its course; a new `filling` cycle
  opens automatically (if the feature is still enabled).
- **cancelled** — an admin drained the pool mid-cycle.

Each cycle freezes its target and duration at creation, so a later
config change never moves the goalposts on people who already
contributed.

Contributions are **donations**: they are never refunded, including
when an admin drains the pool. The pot is only spent by the freeleech
it triggers.

## Interaction with an active bonus event

If the pot fills while another event is already in flight:

- **A freeleech is already active** → the pool waits (`full_queued`)
  and a 60-second cron starts it the moment the blocker ends.
- **A non-freeleech event is active** (e.g. an upload-multiplier
  event) → the pool freeleech starts immediately and *overlays* it:
  the download multiplier is forced to `0` (freeleech) while the
  original event's **upload multiplier is preserved**. When the pool
  window ends, the displaced event is re-created for the time it had
  left, so the operator's schedule isn't lost.

When a pool-triggered freeleech is live, the bonus-event icon and
modal show a dedicated "community pool" treatment, and an overlaid
event shows the original download multiplier struck through next to
the `0`.

## Admin configuration

`/admin/freeleech-pool` exposes:

- **Enable** — master switch. Disabled → the shop widget is hidden.
- **Points target** — the pot size that triggers the freeleech.
- **Freeleech duration** — in whole days (capped at 30).
- **Minimum contribution** and **per-user cap** — the cap is a
  percentage of the target (`0` = no cap), so no single member can
  fill the whole pot.
- **Preset amounts** — quick-fill buttons shown under the contribute
  field.
- **Event title / description templates** — applied to the spawned
  bonus event; left blank, the modal renders a localised default.

### Contribution windows

Optional. With no window configured the pool is always open (subject
to the enable switch). Add one or more windows and contributions are
only accepted while *now* falls inside one:

- **one-off** — a concrete `[start, end)` datetime range.
- **weekly** — weekday + time-of-day bounds (UTC), every week.
- **monthly** — a set of days-of-month + a time-of-day band.
- **yearly** — an anniversary range (month/day → month/day, may wrap
  across the new year).

All recurrence is evaluated in UTC.

## The shop widget

On `/shop`, above the item grid, members see the live pot: a progress
meter, the current state (open / closed / queued / active), the top-5
contributors, their own contribution, and a contribute form (free
amount plus preset buttons). When full the widget shows the pool as
closed/active rather than accepting more points.

## Operations

- A 60-second cron (Redis SETNX lock for multi-replica safety) starts
  queued cycles once their blocker ends and closes expired ones,
  re-spawning any displaced event.
- The pool-created bonus event carries `source = 'freeleech_pool'`;
  the admin bonus-events screen refuses to edit or delete it directly
  (use the pool's reset action instead).
- Prometheus exposes `trackarr_freeleech_pool_enabled`,
  `…_points_current` / `…_points_target` / `…_progress_ratio`,
  `…_state`, `…_contributors_total`, and
  `…_cycles_completed_total`. See [Metrics](../reference/metrics.md).
