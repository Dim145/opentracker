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

Two scripts fill a kept stack with something worth looking at. Neither asserts
anything, so neither is a scenario, and `run.sh` does not call them:

```bash
node tests/e2e/demo.mjs          # roles, both messaging surfaces, a room
node tests/e2e/forumTickets.mjs  # three forum categories, six topics, five tickets
```

Both go through HTTP like the seeder, and both are re-runnable: a topic or a
ticket whose subject is already there is skipped rather than duplicated.
- `--no-build` — reuse the images from the last run
- `--only themes` — run one scenario file

## What the stack is, and is not

Deliberately lean: no PgBouncer (the API talks to Postgres directly, which is
what `MIGRATIONS_DATABASE_URL` does in production anyway), no Caddy (the web
container emits its own CSP, so the policy under test is the real one), no
tracker (nothing here announces). Ports are shifted into the 5xxxx range so it
cannot collide with a development stack.

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
