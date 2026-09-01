# Torrent lifecycle

Three things a catalogue needs to be able to say once it is a few years old,
and could not: *that one replaces this*, *nobody is seeding this*, and *we no
longer carry that*.

## Superseding (trumping)

A better rip of the same work appears. Moderation could already say a release
was rejected; it could not say a release was fine and is simply no longer the
one to take. Without that, a catalogue ages by accumulating duplicates of
uneven quality with no hierarchy between them.

Staff mark it from the older release's page: **Staff tools → Supersede**, by
pasting the replacement's infohash.

### The older release stays online

It keeps its listing, its download, its swarm, and its snatchers keep their
hit-and-run obligations. People are seeding it; pulling it out from under them
would turn a tidy-up into a hit-and-run of the operator's own making.

What changes is that both pages say so. The older one carries a banner pointing
at the replacement — informational, not a warning, because the file is still
perfectly good — and the newer one lists what it replaced.

### The guards

| Refused | Because |
| --- | --- |
| A release superseding itself | The page would point at itself, and the chain walk would not terminate |
| A cycle (A→B→A) | The same non-termination reached the long way round |
| A target that is not `accepted` and active | The pointer would send members to a page they may not be allowed to read |
| A target that is itself superseded | The pointer would be a dead end; point at the head of the chain instead |

The chain walk is bounded at 32 hops, so a cycle that arrived some other way —
a restore, a hand-edited row — cannot hang the request.

## Reseed requests

A torrent at zero seeders used to be a silent dead end: the page showed a zero
and nothing followed from it. The site knows exactly who could fix it —
`hnr_tracking` holds one row per (member, torrent) forever, written both by the
tracker on first completion and by the API the moment somebody clicks download.

Any member can ask, from the torrent page, when the swarm is genuinely empty.
Past downloaders get a notification.

| Guard | Value |
| --- | --- |
| Seeders must be | 0, checked live against Redis |
| One request per torrent per | 24 hours, **site-wide** — not per member |
| Recipients capped at | 200, most recent snatchers first |
| Superseded releases | refused — asking members to resurrect one works against a decision staff already took |

The cooldown is site-wide rather than per member on purpose: the people who
need protecting are the recipients, and ten members each asking once is ten
notifications for one problem. It is a Redis key with a TTL — no column, no
sweep, and it expires by itself.

Erased and banned accounts are skipped. Members who hide their download history
**are** notified: that preference governs who can enumerate their snatch list,
and a notification about one torrent enumerates nothing — though it does tell
them the site remembers, which is worth knowing.

## Unregistered infohashes

`POST /api/torrents/unregistered` takes up to 256 infohashes and says which
this tracker still serves.

The question a torrent client cannot answer on its own: an announce failing
because the tracker is down looks exactly like one failing because the release
was deleted, so the usual answer is to leave dead entries in place forever.

```bash
curl -X POST "https://tracker.example/api/torrents/unregistered?apikey=$API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"infoHashes":["aaaa…","bbbb…"]}'
```

| verdict | meaning |
| --- | --- |
| `active` | served; announces should work |
| `superseded` | served, but a better release replaced it — the replacement's hash comes with it |
| `pending` | uploaded here, not through moderation yet |
| `unregistered` | this tracker has no such torrent |

Rejected and inactive rows deliberately answer `unregistered`. The detail
endpoint and the duplicate preflight both refuse to confirm that a rejected
hash exists — it would turn either into an oracle for enumerating what
moderation turned down — and an endpoint taking 256 hashes at a time is the
last place to open that door.

Authenticate with the **API key** from your profile (see
[Keys](./api-keys.md)), not the announce passkey.

This is also the natural entry point for automated cross-seeding: a script that
knows which of its local torrents this site does *not* have is a script that
knows what to upload.
