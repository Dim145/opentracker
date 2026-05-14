# Metadata Providers

Trackarr enriches torrent rows with rich metadata — cover art, year,
overview, rating, authors / platforms — pulled from external
databases. Three providers ship today, each opt-in via env vars:

| Provider | Type hint | Backed by | Auth |
| --- | --- | --- | --- |
| **TMDb** | `movie` · `tv` | TMDb v3/v4 API | API key |
| **IGDB** | `game` | Twitch OAuth → IGDB API | Client ID + Secret |
| **Open Library** (+ Google Books fallback) | `book` | openlibrary.org public API + Google Books | None (Open Library) · optional API key (Google Books) |

The metadata layer is a small registry — adding a fourth provider
(audiobooks, apps, …) is one file under
`apps/api/utils/metadata/<name>.ts` plus one entry in `index.ts`.
The route enums and FE composable pick the new source up
automatically.

## TMDb (films + TV)

[TMDb](https://www.themoviedb.org) covers movies and TV shows. The
same key powers three sources under the hood — `tmdb` (native id),
`imdb` (resolved through `/find`), `tvdb` (also through `/find`) —
so a row with any one of those ids gets the same enrichment.

### Setup

1. Create an account at [themoviedb.org](https://www.themoviedb.org).
2. Open **Settings → API** and request an API key (free tier is
   plenty — TMDb allows ~40 req/s per key, and we cache hits for
   24h in Redis).
3. Set the env var:
   ```bash
   TMDB_API_KEY=your-key-here
   ```
   Both v3 keys (32-char hex) and v4 Read-Only Access Tokens (JWT
   with dots) work — Trackarr auto-detects which header to use.
4. Restart the API container. The `/admin` dashboard surfaces a
   green pill once a key is present.

### Locale

User language (`/settings` → Language) drives the TMDb `language`
query parameter. A French user gets French titles, taglines and
overviews; English users get English. Cache entries are partitioned
by locale so the two never collide.

::: tip Free vs paid
The free tier of TMDb covers a private tracker comfortably. The
operator-side fields shown to users are public anyway; rate-limit
escalation only matters if you reset the Redis cache often.
:::

## IGDB (video games)

[IGDB](https://www.igdb.com) is owned by Twitch/Amazon and
authenticates through a Twitch OAuth client-credentials grant. The
adapter exchanges your client id + secret for an app-access token
on first use (typically valid ~60 days) and caches it in Redis +
memory.

### Setup

1. Sign in at [dev.twitch.tv](https://dev.twitch.tv/console/apps)
   and register an application — pick "Application Integration" as
   the category and any redirect URI (we don't use it).
2. Copy the **Client ID** and **Client Secret**.
3. Set both env vars:
   ```bash
   IGDB_ID=your-client-id
   IGDB_SECRET=your-client-secret
   ```
4. Restart the API. The game-category upload picker switches from
   "free-text only" to the IGDB search box on next page load.

### Accepted ID formats

The upload form normalises any of these into the canonical id:

- bare numeric id (`7346`)
- canonical slug (`the-legend-of-zelda-breath-of-the-wild`)
- full URL (`https://www.igdb.com/games/<slug>`)

Slug → id resolves via one IGDB ping; the result is cached for 24h.

### Rate limits

IGDB caps at 4 req/s per token. We cache aggressively (24h hits, 1h
misses, 6h search). A 50-game grouped view fans out at most once
per id across all users on the instance.

## Open Library + Google Books (books / ebooks)

[Open Library](https://openlibrary.org) is the primary book
provider — free, key-less, run by the Internet Archive. When the
operator wires the optional Google Books API key, the source falls
back to Google Books for queries Open Library doesn't cover. Both
shapes normalise into the same payload so the rendered card looks
identical; a small `bookProvider` field carries the origin for
debugging.

### Setup

Open Library is **always enabled** — there's nothing to configure.
You only need credentials for the Google Books fallback:

1. Open the [Google Cloud Console](https://console.cloud.google.com/),
   create a project, enable the **Books API**.
2. Create an API key (no OAuth needed) and **restrict it** to the
   Books API.
3. Set the env var:
   ```bash
   GOOGLE_BOOKS_API_KEY=your-key-here
   ```
4. Restart the API. The fallback fires automatically whenever Open
   Library returns zero results.

### Accepted ID formats

The upload form normalises any of these:

- **ISBN-13** (`9780553573404`)
- **ISBN-10** (`055357340X`)
- Open Library **work id** (`OL27448W`)
- Open Library **edition id** (`OL12345M`)
- Full Open Library URL (`https://openlibrary.org/works/OL27448W`)
- Google Books URL containing `?isbn=…`

When both an ISBN and an OL work id are available, we prefer the
ISBN — it's stable across providers and survives a re-edit of the
Open Library record.

## Caching

All three sources share the same TTLs (centralised in
`apps/api/utils/metadata/types.ts`):

| Cache | TTL |
| --- | --- |
| Positive lookups (`meta:v1:<source>:<locale>:<hint>:<id>`) | 24h |
| Negative lookups (`__null__` sentinel) | 1h — short on purpose so an operator can fix a typo without bouncing the cache |
| Search results | 6h |

Per-locale partitioning means an English and a French user on the
same row don't share a cache entry — the cost is at most one extra
upstream fetch per (locale, id) pair, amortised across thousands of
users.

## Troubleshooting

**The picker shows "metadata not configured"** — set the relevant
env var (`TMDB_API_KEY`, `IGDB_ID` + `IGDB_SECRET`, or rely on Open
Library / Google Books for books). Restart the API container so the
new vars are picked up.

**IGDB suddenly returns 503** — the Twitch token expired and the
refresh call failed. Check the API logs for `[metadata:igdb] OAuth
failed`; usually a transient upstream issue. Restart the container
to force a fresh token grant.

**Wrong language on TMDb cards** — verify the user's language in
`/settings`. The cache key includes the locale, so switching it
triggers a fresh fetch (no stale row).

**Books with no cover** — Open Library is a community-edited
database; older or niche books often lack a cover_i. Set
`GOOGLE_BOOKS_API_KEY` to enable the fallback chain.
