# Importing from third-party trackers (cross-seed) — research & decision

**Date:** 2026-08-17 · **Status:** on hold, not implemented · **Method:** Jackett/Prowlarr indexer definitions, upstream UNIT3D code and the Torznab spec, cross-checked against this repo (`file:line`).

Sites studied: [c411.org](https://c411.org), [tr4ker.net](https://tr4ker.net), [yggreborn.org](https://www.yggreborn.org), [gemini-tracker.org](https://gemini-tracker.org).

---

## The goal

**Make cross-seeding easy**, not clone a catalogue. The scenario:

1. The user already seeds content they got from a third-party tracker.
2. They import it here: we fetch the listing, the `.torrent` and the metadata.
3. We **rewrite the announce** to point at our tracker and **keep the `source` field** of the `info` dict if there is one, so **the infohash does not change**.
4. They add our announce to the torrent they are already seeding. Their swarm joins ours without a recheck.

Decisions the maintainer has already made:

- The import **deliberately does not create a seed** — the user brings the data. That is not a defect.
- We want **our swarm**, not the remote tracker's. No announce mirroring.
- We keep `source` **to preserve the infohash** (see below for why that is the right trade-off).
- The `.torrent` is **always rewritten** before storage.

---

## The technical point that unblocked the topic

An earlier analysis wrongly concluded that rewriting the announce broke the import. **It does not, and it matters not to repeat the mistake:**

> The infohash is the SHA-1 of the **`info` dictionary alone** ([BEP 3](https://www.bittorrent.org/beps/bep_0003.html)). `announce` and `announce-list` are **siblings** of `info`, outside it. Rewriting the tracker therefore never touches the infohash.

The repo already demonstrates this: `apps/api/routes/api/torrents/[hash]/download.get.ts:104` injects the passkey into the announce URL on every download, and the infohash does not move a bit.

Corollary about `source`: many private trackers slip a `source` into the `info` dict to make *their* infohash unique. Because it is **inside** `info`, touching it changes the infohash.

- **Keep it** → same infohash as the origin site → a client already seeding can add our announce **without a recheck**. That is what we want for cross-seeding.
- **Replace it** → new infohash → a full recheck on the client before it can seed.

---

## What each site exposes

All four have an **official API with a per-user key**. No scraping is needed for the core requirement.

| Site | Software | Endpoint | Auth | Where to find the key |
|---|---|---|---|---|
| C411 | custom | `GET /api/torznab` | `apikey` in the query | `/user/integrations` |
| TR4KER | custom | `GET /api/torznab/all` | `apikey` in the query | `/mon-compte/parametres` → "Clé API" |
| YggReborn | custom | `GET https://api.yggreborn.org/api` | `apikey` = passkey | official docs at `/guide-api` |
| G3MINI TR4CK3R | **UNIT3D 9.2.0** | `GET /api/torrents/filter` | `Authorization: Bearer` | My Settings → "API Key" tab |

Known rate limits: C411 **15 req/min**, YggReborn ~2 s between requests. Undocumented for the other two.

### Available fields

| Need | C411 · TR4KER · Ygg (Torznab XML) | G3MINI (UNIT3D JSON) |
|---|---|---|
| Name | `title` | `name` |
| **Description** | **absent from the standard** | `description` |
| NFO / MediaInfo | absent | `media_info`, `bd_info` |
| `.torrent` file | `enclosure/@url` | `download_link` |
| Size | `size` | `size` |
| File list | via the `.torrent` | `files[]` (name + size) |
| Category | `category` — **standard Newznab ID** | `category_id` + `category` (label), **site-specific** |
| IMDb / TMDb / TVDb | `imdbid`, `tmdbid` | `imdb_id`, `tmdb_id`, `tvdb_id`, `mal_id`, `igdb_id` |
| Poster / genres | absent | `meta.poster`, `meta.genres` |
| Resolution / type | inferable from the title | `resolution`, `type`, `distributor` |
| Seeders / leechers | yes | yes |
| Uploader | absent | `uploader` |
| Freeleech | `downloadvolumefactor` | `freeleech` |

Source for the UNIT3D detail: [`TorrentResource.php`](https://github.com/HDInnovations/UNIT3D/blob/master/app/Http/Resources/TorrentResource.php) — that is the exact list of rendered fields, not a guess.

---

## The blocker

**Everything cross-seeding needs is reachable over the API on all four sites**: the `.torrent` (hence the `info` dict, hence `source` and the infohash), the title, the size, the category and the external ids.

What is missing, on the three Torznab sites only: **the written description and the NFO**.

Partial workaround without scraping: Torznab carries `imdbid` / `tmdbid`, and the repo already has `apps/api/routes/api/metadata/lookup.get.ts` (`GET /api/metadata/lookup?source=imdb|tmdb|tvdb|igdb&id=…`) which returns poster, synopsis and genres. So the listing can be filled without touching the source site's HTML — we only lose the hand-written release notes.

### What was never settled, and how to settle it

`<description>` **is** a standard RSS element, read by Torznab parsers (SearXNG reads it, for one). The [Torznab 1.3 spec](https://torznab.github.io/spec-1.3-draft/torznab/Specification-v1.3.html) makes only `size` and `category` mandatory and **says nothing about the content of `description`**. Jackett's C411 definition does not read it — but **Jackett only extracts what Jackett needs**, so that proves nothing.

In other words: C411 **may** already return the description and nobody has checked. With a valid key it is one command:

```bash
curl -s "https://c411.org/api/torznab?apikey=$KEY&t=search&limit=1" | xmllint --format - | head -60
```

If `<description>` holds anything beyond the title, the blocker falls and the topic can resume.

---

## Category matching

Stated requirement: automatic detection **plus** the ability to correct by hand before importing.

**On the Torznab side this is a join, not a heuristic.** Torznab mandates a shared namespace (2000 Movies, 5000 TV, 3000 Audio, 4000 PC, 1000 Console, 7000 Books) and the repo **already** has the table mapping our categories to those IDs, because we emit them for our own feed: `apps/api/routes/api/torznab/utils/categories.ts:9` (`NEWZNAB_CATEGORIES`) and the mapping that follows (l.64+). Automatic detection means reading that table backwards. On top of that, `t=caps` returns the remote site's full tree with its own labels — that is the raw material for the mapping screen.

**On the UNIT3D side the tree has to be learned.** `category_id` is site-specific; only the `category` label is readable. First sync: enumerate the (id, label) pairs, propose a match by label, let a human decide. Once per site.

The shape to build if the topic resumes:

1. A persisted `(source, remote_category_id) → category_id` table with an auto/manual flag. **A manual choice must never be overwritten by a resync.**
2. A per-source mapping screen, remote tree on the left, our categories on the right, with a pre-selected proposal.
3. An unmapped category → import **held and flagged**, never a silent "Misc".
4. A preview of the listing before writing, editable — that is the manual upload form, pre-filled.

---

## What the repo already provides

| Existing | Reuse |
|---|---|
| `apps/api/routes/api/torznab/` (+ `utils/categories.ts`, `utils/xml.ts`) | We already **produce** Torznab: vocabulary, categories and serialisation are settled. Only the reading direction is missing. Our own endpoint is a test bench before we hold a single third-party key. |
| `apps/api/utils/safeFetch.ts` | Outbound network guarded against SSRF, already covered by tests. |
| `apps/api/routes/api/metadata/lookup.get.ts` | Fills poster/synopsis/genres from an `imdbid`/`tmdbid`. |
| `apps/api/utils/federation/` + `remoteTorrents` (`packages/db/src/schema.ts:2191`) | Same shape: remote source → local cache → render. Careful, `remote_torrents` is a **catalogue mirror** pointing back at the origin instance — a cross-seed import writes into `torrents` instead, a different table with a different intent. |
| `apps/api/utils/channels/` | Adapter pattern to copy (10 channels behind a common interface). |

Two adapters cover all four sites: **Torznab (XML)** and **UNIT3D (JSON)**. The second pays off most — it will work as-is on the dozens of other UNIT3D trackers.

---

## Implementation points not to forget

- **`torrents` has no provenance column.** (`packages/db/src/schema.ts:844`+: `infoHash` unique l.848, `torrentData` l.853, `uploaderId` l.854, `categoryId` l.855.) The `source` at line 263 belongs to `bonusEvents`, not `torrents` — an easy misreading. An import will have to add provenance.
- **`infoHash` is already `unique()`** (l.848): that is the natural dedup constraint. Plan for a merge rather than a hard failure when the content already exists.
- **Never persist the original `.torrent` as-is**: it carries the passkey of whoever downloaded it, i.e. their identity on the source site. Rewrite the announce **before** any database write.
- **API keys are identities.** Encrypt at rest, never log them, never include them in an export, never return them to the client after entry. Store them **per user**, nothing instance-wide.
- **Ygg passkeys are bound to the IP** that generated them. A server that changes IP breaks the integration with no clear message — handle that in the diagnostics.
- **Cloudflare.** The public pages of `yggreborn.org` and `gemini-tracker.org` returned **403** from a dev machine, and the G3MINI indexer request mentions a CF 525 error. The API subdomains appear to be spared — **verify from the server's IP before writing any code**.
- **Rate limits.** A search fanning out to four sources burns through C411's 15 req/min quickly: cache per (source, query) and queue per user.
- **Site rules.** Using the API with your own key is expected; republishing their content elsewhere generally is not, and a preserved infohash is traceable. A trade-off the maintainer accepts, recorded here so it is not a surprise later.

---

## Decision

**On hold as of 2026-08-17.** Reason: outside G3MINI (UNIT3D), the description and the NFO are not reachable over the API, and the maintainer does not want HTML scraping — least of all behind Cloudflare.

Two doors remain open to resume:

1. **Check `<description>` on C411** with the `curl` command above. If the field is genuinely populated, the three Torznab sites become viable again and the topic restarts.
2. **Build only the UNIT3D adapter.** G3MINI already gives a complete import in one call, and the adapter is reusable across the whole UNIT3D ecosystem. That is the best work-to-coverage ratio if we want to move without waiting.

---

## Sources

- [UNIT3D — `TorrentResource.php`](https://github.com/HDInnovations/UNIT3D/blob/master/app/Http/Resources/TorrentResource.php) — the exact fields the API renders
- [UNIT3D — torrents API docs](https://hdinnovations.github.io/UNIT3D/torrent_api.html)
- Jackett definitions: [c411](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Common/Definitions/c411.yml) · [tr4ker](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Common/Definitions/tr4ker.yml) · [yggreborn-api](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Common/Definitions/yggreborn-api.yml) · [g3minitr4ck3r-api](https://github.com/Jackett/Jackett/blob/master/src/Jackett.Common/Definitions/g3minitr4ck3r-api.yml)
- [Jackett #16517](https://github.com/Jackett/Jackett/issues/16517) — the G3MINI request, which reveals UNIT3D 9.2.0
- [Torznab 1.3 specification](https://torznab.github.io/spec-1.3-draft/torznab/Specification-v1.3.html)
- [BEP 3](https://www.bittorrent.org/beps/bep_0003.html) — `.torrent` structure, infohash = SHA-1 of the `info` dict
- [api-ratio](https://github.com/sabuontop/api-ratio) — multi-tracker stats retrieval, if "import your own data" ever comes back
