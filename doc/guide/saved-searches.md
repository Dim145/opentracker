# Saved searches

Store a filter, get a notification when a matching upload is accepted. The
server-side half of what members do today with autobrr — and unlike an IRC
announce channel, it works for the member who has no seedbox and no bot, which
is most of them.

## Creating one

Search the catalogue as usual, then **Save this search**. The filter is taken
from what is on screen, which is the point: retyping criteria into a separate
form is how a saved search ends up not matching what you were actually looking
at.

Manage them at **/alerts**.

## What a filter can hold

Exactly the catalogue's own vocabulary, and no more:

| Criterion | Notes |
| --- | --- |
| Free text | Matched against the release **name** |
| Category | One |
| Tags | All of them must be present — the listing's AND semantics |
| IMDb / TMDb / TVDb id | Exact |

Resolution, source and codec are **tags** here, as they are in the catalogue —
`1080p`, `bluray`, `x265` are derived from the release name at upload. So "1080p
Blu-Ray x265" is three tags, not three new fields.

A filter with no criteria at all is refused: it would match every upload
forever, which is not a saved search but a firehose.

## What it matches against

**The release name only.** The live search can also read descriptions and NFOs,
because a reader is looking for something and a wider net helps. An alert firing
on a word buried in an NFO is a notification nobody can account for.

The text is normalised at save time and stored **without** the trailing prefix
marker the live search uses. That marker exists because the member is still
typing — `crown` should match `crownfall` while the query bar has focus. A saved
alert is settled intent, and the same behaviour there would fire "The Crown" on
every release whose title merely starts the same way.

The typo-tolerant fallback is not carried over either: it exists to rescue an
empty results page, and on a per-torrent test it would only produce false
positives.

## What it will never do

- **Push adult content to somebody who turned it off.** Checked against the live
  preference, not the one in force when the filter was saved.
- **Name an anonymous uploader.** The notification says what appeared, never who
  put it there.
- **Tell you about your own upload.**

## For operators

`saved_search_max_per_user` — **default 20**.

Every armed filter is evaluated against every accepted upload, so this is the
knob that bounds the feature's cost. The evaluation is inverted — one query asks
Postgres which stored filters match this one torrent, rather than running each
filter's catalogue query — so a thousand members with twenty filters each is one
indexed query per upload, not twenty thousand.

The fan-out logs its own duration when it exceeds half a second, so a sweep that
is getting slow shows up in your logs before it shows up in complaints.
