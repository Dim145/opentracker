# The catalogue

`/torrents` is where members spend their time. It answers two different
questions with two views, and it takes what you type rather than making you fill
a form.

## The bar understands what you type

Type into the search bar and words that mean something become **chips** —
removable, and reflected in the URL so the search can be shared or bookmarked:

| What you type | What it becomes |
| --- | --- |
| `s02e04`, `s02`, `e04` | Season and episode |
| `1080p`, `bluray`, `x265`, `multi`, `hdr` | The matching tag family |
| `2019` | Year, matched inside the release name |
| `@member` | Uploads by that member |
| An IMDb / TMDb / TVDB link or id, an ISBN | That work's releases |
| A 40-character infohash | That single release |

Everything the bar does not recognise stays free text, matched against the
release name — and, since 0.36.0, against the **titles of the works** the
metadata cache knows. A file named `Sousou.no.Frieren.S01E10.MULTi.1080p` is
therefore found by typing `frieren`, and a near miss ("friren") comes back as a
*did you mean* suggestion rather than an empty page.

Pressing `/` anywhere on the page focuses the bar. Focusing it opens a panel
with the works matching what you have typed, the releases you viewed recently,
and your recent searches — all of which are stored in your own browser, never on
the server.

## Two views

**Works** (the default) groups releases by the work they belong to: one card per
film, series, album, game or book. The card says what exists without opening
anything — the categories, how many releases, the resolutions and sources
available, the swarm, the size range, the age of the newest release.

Clicking the card — anywhere on its header, or the chevron at its end — unfolds
it. Inside, a series reads as seasons, then episodes, then the release lines;
each level carries its own count, resolutions and seeders, so you choose the
episode before you choose the file. The pills on the header (*per episode*,
*full seasons*, *integral*) pick which cut you are looking at; they open on the
cut of the first release under the current sort.

**Releases** is the flat list: one row per release, with quality chips, size,
swarm and age. It is the view to use when you already know what you want and
care about the file rather than the work.

The toggle sits in the page header, and the choice is remembered in your
browser. An operator can change which view a new visitor lands on.

## The rail of facets

The column on the left counts everything it offers: categories with their
sub-categories, resolutions, sources, codecs, languages, HDR formats, audio
formats, years as a histogram, and six member options:

| Option | Keeps |
| --- | --- |
| With seeders | Releases someone is actually seeding |
| Last 24 hours | What arrived since yesterday |
| Freeleech | Downloads that do not count against your ratio |
| Not taken yet | Releases you have never downloaded |
| Hide replaced | Drops releases a corrected version supersedes |
| My favourites | Only what you starred |

Counts are computed for the search you already have, so a facet that would
return nothing shows a zero rather than lying. They are cached for twenty
seconds per member.

On a phone the rail becomes a sheet, opened by the **Filters** button at the
bottom right; the badge on it carries the number of results.

## Sorting

Newest first by default, or by name, size, seeders, leechers and completed
count. When there is text in the bar, **relevance** becomes available and is
picked for you: it ranks by the full-text score of the release name, with
recency as the tiebreaker.

## When nothing comes back

The empty state does not apologise, it proposes: the count the catalogue would
return without each of your criteria (drop the text, drop the category, drop a
tag family), the works whose titles nearly match what you typed, and two ways
out — open a request, or save the search as an alert so the first matching
upload notifies you.

Text searches that return nothing are also counted, without who searched, for
the operator to read at `/admin/search-misses`: it is the list of what members
look for and the catalogue does not have.

## The Torrents menu

Hovering **Torrents** in the header opens the catalogue without loading it
first: four shortcuts (the whole catalogue, today, freeleech, your favourites),
your recent searches, and every category family with its sub-categories, each a
direct link to the filtered catalogue. The chevron opens the same menu by click
and by keyboard; on a touch screen only the chevron does, since there is no
hover to speak of.

## Your defaults, and the instance's

**Make these filters my default** stores the current filters on your account:
the catalogue then opens on them when you arrive with no parameters in the URL.
The same button clears them.

An operator sets what everyone else lands on, in `/admin/settings` → *Search*:

| Setting | Effect |
| --- | --- |
| Default view | Works or releases for a visitor with no stored preference |
| Default sort | `auto` (newest, or relevance when there is text) or a fixed key |
| Page size | 10 to 50 rows per page |
| Visible facets | Which sections the rail offers |

## Sharing a search

Every filter lives in the URL, so a search is a link:

```
/torrents?q=frieren&tk=1080p,2160p&se=2&o=free,seeded&s=seeders&v=simple
```

| Parameter | Meaning |
| --- | --- |
| `q` | Free text |
| `c` | Category id |
| `tag` | Tag slugs, comma-separated (AND) |
| `tk` | Tag families — a space between families, commas between synonyms (OR) |
| `se`, `ep`, `y` | Season, episode, year |
| `u` | Uploader name |
| `imdbid`, `tmdbid`, `tvdbid` | External id |
| `o` | Options, comma-separated (`seeded`, `today`, `free`, `untaken`, `current`, `favorites`) |
| `s`, `d` | Sort key and direction |
| `v` | `grouped` or `simple` |
| `p` | Page |

The same vocabulary is what [saved searches](./saved-searches.md) store, so an
alert reopens exactly the search that created it.
