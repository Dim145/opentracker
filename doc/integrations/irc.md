# IRC announce channel

One line in a channel per accepted upload. It is the oldest integration in
private trackers and still the fastest: an RSS feed is polled once a minute, a
channel message arrives when the release does.

[autobrr](https://autobrr.com) and autodl-irssi both work this way, and between
them they are how releases are actually raced.

Off by default. Nothing is said anywhere until an operator turns it on under
**Admin → IRC announce**.

## What the bot does, and what it will never do

It connects to one server, joins one channel, and says one line per accepted
release. That is the whole surface.

It never reads a command from the channel. Nothing anybody says to it makes it
do anything — the only inputs it acts on are `PING` and the numerics it needs to
know it is connected. A bot that took orders from a channel would be a remote
control for the tracker, gated on IRC's idea of identity, and IRC does not have
one.

It also never speaks to a user, never joins a second channel, and never carries
a passkey in a line (see below).

## The line

The default format:

```
NEW [{category}] {name} :: {size} :: FL {freeleechPercent} :: UL x{uploadFactor} :: {tags} :: by {uploader} :: {url} :: {infoHash}
```

which renders as:

```
NEW [Movies] Example.Release.2026.1080p.BluRay.x264-GROUP :: 14.62 GiB :: FL 100% :: UL x2 :: 1080p, bluray, x264 :: by example :: https://tracker.example.com/torrents/0123…4567 :: 0123456789abcdef0123456789abcdef01234567
```

Every field is always present. A release with no tags says `-`, an anonymous
upload says `anonymous`, a release with no buff says `FL 0%`. A fixed shape
costs a few characters and buys a parser with no optional groups — and an
optional group is how a client silently attributes one field's value to another
when the middle one is missing.

A colon is stripped from every value, because the format reserves it. Tag names
are the reason: they are free text, and one tag called `quality:high` would
otherwise make every release carrying it unparseable.

### Fields

| Token | autobrr variable | Meaning |
| --- | --- | --- |
| `{name}` | `releaseName` | the release name — truncated first if the line would overflow, so the hash at the end always survives |
| `{category}` | `category` | the category, or `uncategorised` |
| `{size}` | `torrentSize` | total size, e.g. `14.62 GiB` |
| `{freeleechPercent}` | `freeleechPercent` | how much of the download is free |
| `{uploadFactor}` | — | the upload multiplier, for people |
| `{tags}` | `tags` | comma-separated tags, or `-` |
| `{uploader}` | `uploader` | the uploader, or `anonymous` |
| `{url}` | — | the release page, for people |
| `{infoHash}` | `torrentId` | the v1 infohash — what a download URL is keyed on |

Two fields are printed for humans and mapped to nothing. autobrr has no variable
for an upload multiplier, and `{url}` is the page rather than the base URL its
own templates prepend. Claiming a variable it ignores would make the definition
look richer and behave identically.

The seeding requirement is deliberately **not** in the line: autobrr reads
`minimumratio` and `minimumseedtime` from the [Torznab feed](./torznab.md),
which this site serves, and there is no IRC variable for either.

### No key in the line

The URL in the announce carries no credential. Everybody in the channel sees
every line, so a personalised download link would hand every member the
credentials of one. A client appends its own key — that is what the generated
definition's `downloadurl` template does.

## The generated autobrr definition

`/api/irc/autobrr.yml` (Admin → IRC announce → **autobrr definition**, or
directly from a member's own session) returns an indexer definition for this
instance.

It is generated rather than shipped, and the reason is the format above: the
line is a template an operator may edit, so a hand-written definition would be a
guess about a string in somebody else's database. The regular expression in the
file is **derived from the template in force**, so the two cannot disagree. Edit
the format, download the file again.

The definition also carries a `tests` block — a rendered sample line and the
values it should yield — so it arrives with a proof that it parses this
instance's format.

To use it:

1. Download the file and drop it in autobrr's custom definitions directory.
2. Restart autobrr.
3. Add the indexer, paste your **API key** from Settings → Keys, and give your
   IRC nick.

Use the API key, not the announce passkey. A passkey handed to a third party can
announce on your behalf; a read key cannot. See [API keys](../guide/api-keys.md).

## Configuring it

**Admin → IRC announce.**

| Field | Notes |
| --- | --- |
| Server / port / TLS | 6697 with TLS is the modern default. |
| Nick | Some networks require a bot suffix before letting a client into an announce channel, e.g. `trackarr\|bot`. |
| Channel / key | The key is stored encrypted. |
| SASL account / password | Preferred when the network offers it. |
| Server password | For networks that want one before registration. |
| Lines to send after connecting | One raw IRC line per row, sent after registration and before joining — identifying to NickServ, or asking a channel bot for an invite. Treated as a secret: the console shows how many are stored and never shows the lines themselves. Leave the field empty to keep them; type into it to replace them. |
| Public address | Where the link in the line points. The bot has no HTTP request to derive it from; with this empty the line carries a path. |
| Announce adult releases | Off by default — see below. |

The three credentials are stored encrypted at rest, with the same key as the
notification-channel secrets (`CHANNEL_ENCRYPTION_KEY`, falling back to
`NUXT_SESSION_SECRET`). The console never returns them; a blank field means
"keep the stored one".

### Adult releases

Off by default, and this is a judgement rather than a convenience. A channel is
one stream with no per-member preferences in it: everybody who joins sees every
line. Members can turn adult content off on the site, and a channel cannot
honour that — so the operator decides once, for the channel, and the default is
the direction that does not put titles in front of people who turned them off.

### Anonymity

A member who uploads anonymously is never named in the channel. The line says
`anonymous`, using the same rule as the catalogue, the feeds and the federated
catalogue.

## One bot, however many API instances

Exactly one API process holds the connection, elected through a Redis lease it
renews every fifteen seconds. Three instances would otherwise mean three bots in
the channel and every release announced three times — to autobrr, which would
grab it three times.

The line itself is rendered on whichever instance accepted the release and
published to Redis; the lease holder is subscribed and says it. That indirection
is the whole reason the feature works in a fleet: an upload is served by any
instance, and only one of them has a socket.

The console shows whether the instance you are looking at is the one holding the
connection. If it is not, the state shown is what that instance last knew — but
the test button still works from there, because the test line travels the same
way an announce does.

A release is announced **once**, not once per approval: an ordinary edit sends a
torrent back through moderation, and re-approving it must not put the same line
in the channel again. The marker lasts a fortnight.

## Failure, and what it costs

Announcing is never on an upload's path. A channel that is down, a server that
is throttling, a mistyped host — none of it can slow down or fail an upload or a
moderation action. The failure mode of an announce is a missing line.

Lines wait in a bounded queue while the bot is disconnected, and past the cap the
**oldest** are dropped: on an announce channel a stale release is worth less than
a fresh one. The console shows how many were dropped.

Writes are paced at one line every 1.5 seconds — measured from the last line
actually sent, so ten uploads accepted in the same second leave over fifteen
seconds rather than in one burst. Servers kill clients that talk too fast, and
the penalty is a disconnect mid-burst, which would lose exactly the run of
releases a moderator just accepted.

A connection that stops carrying traffic is dropped and rebuilt: without that, a
peer that dies without closing the socket leaves the bot reporting itself in the
channel while every line goes nowhere.

## Format changes

The template lives in the database, so upgrading the tracker never changes what a
running instance emits: a new default applies to new installations, and yours
keeps saying what it says today.

If you do change the format, the generated definition changes with it, and
members have to download it again. Tell them — a definition that no longer
matches fails silently, which is the one failure mode worth being loud about.
