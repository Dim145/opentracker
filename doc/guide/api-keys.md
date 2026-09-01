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

## Rotating

Each key rotates independently, behind a fresh-login step-up. The old value
stops working **on the next request** — these are read straight from the row,
with no cache in front of them, which is what makes "revoke" mean revoke.

Rotating the announce passkey still breaks every `.torrent` in your client, as
it always did. That is why the other two exist.

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
