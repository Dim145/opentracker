# Keys

Every member has three, and they do different jobs:

| Key | Opens | Can announce |
| --- | --- | --- |
| **Announce passkey** | the tracker's announce and scrape | **yes** |
| **RSS / Torznab key** | RSS feeds, the Torznab endpoint | no |
| **API key** | programmatic calls | no |

All three are on your profile page, under **Credentials**.

## Why three

One secret used to do all three jobs. A member who pasted their feed URL into a
third-party service was handing over the credential that announces on their
behalf — and the only remedy, rotating the passkey, broke every torrent in their
client at the same time.

Splitting them means each can be revoked for its own reason. Rotate the key you
gave to a service that turned out to be careless, and nothing else moves.

## What a read key still gets you — read this before pasting one anywhere

A read key cannot announce. It can, however, **download `.torrent` files**, and
a `.torrent` from this site carries your announce URL — which carries your
passkey. That is how BitTorrent works: the file has to name a tracker the client
can announce to, as you.

So the honest boundary is:

- A read key in a feed reader, an *arr stack or an autobrr you control: exactly
  what it is for. Your passkey never appears in a feed URL or in anybody's
  access log, and you can revoke the key without touching your client.
- A read key handed to somebody you would not trust with your passkey: **not
  safe.** One grab hands them a file with your announce URL in it.

Anything that can download a torrent from this tracker on your behalf can
announce on your behalf. The keys reduce exposure and make revocation
independent; they do not turn a third party into a stranger.

## Rotating

Each key rotates independently, behind a fresh-login step-up. The old value
stops working **on the next request** — these are read straight from the row,
with no cache in front of them, which is what makes "revoke" mean revoke.

Rotating the announce passkey still breaks every `.torrent` in your client, as
it always did. That is why the other two exist.

One caveat on "the next request": the tracker caches a passkey → account lookup
for up to a minute, so an announce with a just-rotated passkey can still be
accepted for that long. The read keys have no cache in front of them.

## Minted on demand

The read keys are created the first time you open the Credentials card, not at
registration. A member who never wires up a feed reader should not be carrying
two live secrets they have never seen.

## For operators: the legacy window

`legacy_passkey_read_access` — **default `true`**.

While it is on, the announce passkey still authenticates the read surfaces, as
it always did. That is a migration stance, not a preference: every feed URL your
members have configured anywhere carries the passkey, and turning this off on
the day of the upgrade would break all of them at once — the exact breakage the
split exists to prevent.

Turn it off once your members have moved over. The Credentials card tells them
to, and says why.

## What the split does not change

- **`.torrent` files** carry the announce passkey and only that. The read keys
  never appear in one.
- **Panic mode** encrypts all three. A panicked database carrying two secrets in
  plaintext would be a "the data is encrypted" that is only mostly true.
- **Erasure** clears all three.
- **Caddy's access log** now strips `apikey` and `rsskey` alongside `passkey`.
  Before the split, `apikey` *was* the passkey, so the existing scrub covered it
  by accident rather than on purpose.
