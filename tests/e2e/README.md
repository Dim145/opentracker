# End-to-end harness

A throwaway stack and a set of scenarios that drive it over HTTP, the way a
browser does. It exists because the integration suite cannot see the seam it is
meant to cover: every unit in a feature can be correct and tested while the
route that composes them forgets to call one of them.

That is not hypothetical. The first run of `themes.mjs` found exactly that —
`/api/branding` was serving role-reserved themes to every member, because the
per-member filtering had been left to the client on the strength of a comment
saying the session payload carries the member's roles. It does not. Both
`choosableFor()` and `roleIdsFor()` were already covered by the integration
suite, and neither was at fault.

## Running it

```bash
bash tests/e2e/run.sh
```

Builds the API and web images from the working tree, brings up Postgres 18 +
Redis 8 + api + web, applies the real migration chain from an empty database,
seeds accounts through the real registration flow, and runs the scenarios.

Useful flags:

- `--keep` — leave the stack running afterwards, for poking at
  <http://localhost:53000> (web) and <http://localhost:54000> (api)

Four scripts fill a kept stack with something worth looking at. None asserts
anything, so none is a scenario, and `run.sh` does not call them:

```bash
node tests/e2e/demo.mjs          # roles, both messaging surfaces, a room
node tests/e2e/forumTickets.mjs  # three forum categories, six topics, five tickets
node tests/e2e/demoTorrents.mjs  # ten releases, a cross-seed, a supersession, a swarm
node tests/e2e/demoSwarm.mjs     # a swarm for every torrent already in the catalogue
```

All four go through HTTP like the seeder, and all four are re-runnable: a topic,
a ticket or a torrent that is already there is skipped rather than duplicated,
and `demoSwarm` derives each peer_id from the infohash so a second run
re-announces the same peers instead of doubling the swarm.

### A real catalogue

Hand-made fixtures are clean by construction, which is exactly what a layout is
not tested by. To fill the stack from an operator's own `pg_dump` instead:

```bash
bash tests/e2e/import-dump.sh /path/to/dump.sql
node tests/e2e/demoSwarm.mjs
```

It takes `torrents` and what hangs off it — categories, tags, links, comments,
the swarm snapshot, favourites, moderation threads, seed obligations. It does
**not** take the `users` table: that one carries `auth_verifier`, `passkey`,
`totp_secret` and `panic_password_hash`, so uploader and author ids are remapped
onto the harness accounts instead. The dump may come from an older schema — the
columns are read from its own `COPY` headers and checked against the running
database, and the import refuses to start if one has since disappeared.

### TMDb

`tests/e2e/tmdb.env` is read by the `api` service if it exists, and `run.sh`
writes it from the repository's own `.env`. Without a key the stack works
perfectly well — but every detail page then renders its "no poster" substitute,
which for a long time was the only state anybody had ever looked at.
- `--no-build` — reuse the images from the last run
- `--only themes` — run one scenario file

## What the stack is, and is not

Deliberately lean: no PgBouncer (the API talks to Postgres directly, which is
what `MIGRATIONS_DATABASE_URL` does in production anyway), no Caddy (the web
container emits its own CSP, so the policy under test is the real one). Ports
are shifted into the 5xxxx range so it cannot collide with a development stack.

The tracker **is** here, on port 54200, even though no scenario announces. It
earns its build because without it every swarm renders empty — and a page that
only ever shows its zero-seeder state has never really been looked at.

Every secret in `docker-compose.yml` is obviously fake and hardcoded. This stack
is not reachable from anywhere and is destroyed at the end of a run.

## Accounts

Registration and login go through the zero-knowledge flow and the proof-of-work
gate exactly as the browser does — `seed.mjs` imports `crypto.ts`, the browser's
own module, which runs unchanged on Node because WebCrypto is global there. No
SQL shortcut, so the sessions are real ones.

| Account | Role |
|---|---|
| `founder` | first registered, therefore admin **and owner** |
| `donator` | plain member, holds the `E2E Donator` role |
| `plainuser` | plain member, no roles |

The first account needs a panic password (see
[panic mode](../../doc/guide/panic-mode.md)); the seeder supplies one. The other
two need registration to be open, which the runner sets.

## On the rate limiter

A seeding script looks exactly like an attack: the DDoS layer blacklists the
caller's IP after a burst of auth calls, and the per-route limiters kick in well
before that. That is correct behaviour and the scenarios do not disable it —
they pace themselves, and the runner clears the counters in Redis between
phases. That is legitimate for a stack the harness owns and destroys; it is not
a switch that exists in production.
