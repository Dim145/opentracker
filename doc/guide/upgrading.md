# Upgrading

Trackarr applies its committed migrations at boot, so an upgrade is normally:
pull the new images, restart, done. No migration to run by hand, no downtime
window to plan beyond the restart itself. A migration that fails aborts the
boot, so a container that comes up has the schema its release expects.

It used to `drizzle-kit push --force` instead, diffing `schema.ts` against the
live database on every start. If you are coming from an image that did, there
is **one command to run once** before the first boot on a migrating image — see
[Coming from a pushing image](#coming-from-a-pushing-image-one-time-baseline)
below. It is the only upgrade on this page that cannot be skipped.

This page records the upgrades that need more than that.

## Always

Take a database backup before pulling new images. See
[Backup & restore](./backup-restore.md). Everything below assumes you can roll
back.

## Coming from a pushing image — one-time baseline

**Who this is for:** every instance that existed before the switch to
migrations. If your database was created by a Trackarr image that pushed its
schema at boot, this applies to you, whatever version you are on.

**What goes wrong without it.** The migrator applies everything recorded after
the newest row in `drizzle.__drizzle_migrations`. A database that has never held
that table has no rows, so "everything after" is the whole chain from 0000 —
run against a schema that already contains most of it. Baselining writes the
rows for what the database already has, so the boot applies only the rest.

Run it once, against the database, before starting the new image:

```
DATABASE_URL=postgres://user:pass@host:5432/trackarr pnpm db:baseline
```

It refuses to do anything on a database that already has rows, so running it
twice is safe. Then start the new image as usual; the boot log will say which
migrations it applied.

**What to expect.** Rehearsed on both kinds of database this applies to, with
a restored dump each time:

| Coming from | Tables | Indexes | Data |
|---|---|---|---|
| 0.21.x | 47 → 58 | 128 → 176 | untouched |
| an instance push had kept current | 58 → 58 | 161 → 176 | untouched |

Both end column-for-column and index-for-index identical to a database the
chain builds from empty. The index counts are the point of the exercise: `push`
had drifted past 15 indexes that `schema.ts` declares, so they existed in no
push-maintained database. Most are speed — the full-text indexes on `torrents`
and the two the grouped catalogue rides, which had been sequential scans — but
`user_signing_keys_current` is a partial unique index, and it is the only thing
enforcing one live signing key per member.

If a migration fails the boot stops and prints the failing statement, which is
deliberate: serving on a half-migrated schema is worse. `SKIP_DB_MIGRATIONS=true`
skips the step and `IGNORE_DB_MIGRATION_FAILURE=true` boots anyway, both for
getting out of a hole rather than for normal use.

## Upgrading to PostgreSQL 18 and Redis 8

The compose files moved from `postgres:16-alpine` to `postgres:18.6-alpine` and
from `redis:7` to `redis:8.10.1-alpine`. One of those is a restart. The other is
not.

### Redis 8 is a restart

RDB and AOF are forward-compatible from 7, so pull and restart. The 8.0 breaking
change was ACL categories absorbing the Search, JSON, time-series and
probabilistic commands; this stack authenticates with `requirepass` rather than
ACLs, so it is unaffected.

Verified against the production hardening — `read_only: true`, `cap_drop: ALL`
plus SETGID/SETUID/DAC_OVERRIDE — with the primitives the tracker actually
relies on: single-key Lua scripts, `SET NX PX` for the credit dedup,
`volatile-lru`, and AOF `everysec`. All behave as on 7.

### PostgreSQL 18 is not

A major version will not read an older data directory. Pull the new image
without doing anything else and Postgres exits immediately:

```
FATAL:  database files are incompatible with server
DETAIL: The data directory was initialized by PostgreSQL version 16,
        which is not compatible with this version 18.6.
```

**And there is a second change specific to the Docker image.** From 18 on, the
official image's default `PGDATA` moved to `/var/lib/postgresql/<major>/docker`,
while this stack has always mounted its volume at `/var/lib/postgresql/data`.
The compose files therefore now set `PGDATA: /var/lib/postgresql/data`
explicitly. Keep that line: it is what makes an upgraded cluster be found where
it already lives.

### The procedure: dump, restore into a new volume

Recommended over an in-place `pg_upgrade` for one reason — it never touches the
old volume, so rolling back is starting the old container again.

```bash
cd /path/to/trackarr

# 1. Stop everything that writes. Postgres stays up; nothing else may hold a
#    connection while the dump runs.
docker compose -f docker-compose.prod.yml --env-file .env stop web api tracker

# 2. Dump globals and all databases from the RUNNING old container.
#    pg_dumpall, not pg_dump: it carries the roles too.
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  pg_dumpall -U "${DB_USER:-tracker}" > trackarr-pg16.sql

# 3. Check it is not empty before you trust it.
wc -l trackarr-pg16.sql && tail -1 trackarr-pg16.sql

# 4. Take the old volume out of the way, keeping it. Renaming beats deleting:
#    this is the rollback.
docker compose -f docker-compose.prod.yml --env-file .env down
docker volume create trackarr_postgres_data_pg16
docker run --rm -v trackarr_postgres_data:/from \
  -v trackarr_postgres_data_pg16:/to alpine:3 \
  sh -c 'cd /from && cp -a . /to'
docker volume rm trackarr_postgres_data

# 5. Bring up ONLY Postgres 18 — it initialises a fresh cluster on the empty
#    volume — then restore.
docker compose -f docker-compose.prod.yml --env-file .env up -d postgres
until docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
        pg_isready -U "${DB_USER:-tracker}"; do sleep 2; done
docker compose -f docker-compose.prod.yml --env-file .env exec -T postgres \
  psql -U "${DB_USER:-tracker}" -d postgres < trackarr-pg16.sql

# 6. Everything else.
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Step 5 prints two errors and both are harmless, because `pg_dumpall` emits
`DROP ROLE`/`CREATE ROLE` for the role you are connected as:

```
ERROR:  current user cannot be dropped
ERROR:  role "tracker" already exists
```

Anything else in that output is not harmless. Read it.

**What the restore carries over**, verified on a seeded cluster: every row, the
`pg_trgm` extension and its GIN trigram indexes, the per-table `reloptions` that
migration 0032 sets (`fillfactor=85`, the autovacuum scale factors) and all
roles. A `pg_dumpall` restore is not a downgrade in fidelity.

**Afterwards**, once the site is confirmed working, reclaim the space:

```bash
docker volume rm trackarr_postgres_data_pg16
rm trackarr-pg16.sql
```

Do that last, not first. The dump file contains every credential hash in the
database — treat it like a backup, and delete it rather than leaving it in the
deploy directory.

### Rolling back

Nothing was destroyed, so: `down`, restore the volume copy back over
`trackarr_postgres_data`, put `postgres:16-alpine` back in the compose file,
drop the `PGDATA` line, `up -d`.

### On pgautoupgrade

`pgautoupgrade/pgautoupgrade` runs `pg_upgrade --link` in place and looks
attractive because it is one command. Two things to know before reaching for it.

It reads `PGDATA`, and its 18 images default to the *new* path. Run it against
this stack's mount without setting `PGDATA=/var/lib/postgresql/data` and it
finds nothing to upgrade at the path it looked at, initialises an empty cluster,
prints `no upgrade to do` — **and exits 0.** Start the stack after that and the
site is up with an empty database while the upgrade appears to have succeeded.

And `--link` rewrites the volume in place, so an interruption leaves it
half-converted (`old/`, `new/` and an `upgrade_in_progress.lock`) rather than
leaving you a clean rollback. Recoverable, but not while the site is down and
you are reading its source to work out what state it is in.

If you use it anyway: set `PGDATA` explicitly, and copy the volume first.

### Kubernetes

The Helm chart sets `postgresql.version.postgresql: "18"`, which CloudNativePG
turns into the operand image. Changing that value on a cluster that already has
data is a major upgrade the operator performs *offline* — it stops the cluster,
runs `pg_upgrade` and restarts. None of the above applies; read CloudNativePG's
own documentation for it, and take a backup first regardless.

## Upgrading to 0.33 or later — themes

Nothing to run. Two tables arrive with the migrations (`themes`,
`uploaded_fonts`), both empty, and the appearance is unchanged until somebody
creates a theme.

Four things an operator should know, none of them urgent:

**Do not run two versions against the same database at once.** A migration makes
`users.theme` nullable, and NULL means "follow the site default" — a meaning the
older code does not have. It reads NULL, treats it as `dark`, finds that this
differs from the session, and rewrites the session; on the next poll it differs
again. The result is a session write and a `Set-Cookie` on every
`/api/auth/status` for those members, forever, and they see `dark` rather than
your default.

This only bites where two versions overlap: a rolling deploy with mixed
replicas, or a rollback to the previous version AFTER the migration has run. A
single instance that stops and starts cannot hit it. If you do roll back, the
accounts created in between hold NULL and will loop until they pick a theme by
hand — the older `PATCH /api/me` will not let them clear it.

Members who were on `Dark` before the upgrade keep `Dark`, deliberately: a
stored `'dark'` cannot be told apart from "never chose", and moving the people
who did choose would be the worse of the two mistakes. Anyone who wants to
follow your default can pick `Site default` in their settings.

**The interface is now in `rem` throughout.** 938 `font-size` declarations that
were in `px` are not any more, so a visitor who has set a larger default font
size in their browser will see the small labels scale with it where they
previously did not. That is the intended behaviour and there is no setting to
put it back; a theme's `ui-scale` moves everything together on top of it.

**Fonts are self-hosted.** `fonts.googleapis.com` and `fonts.gstatic.com` are
gone from the Content-Security-Policy — no visitor's IP reaches Google any more.
The cost moves to the build: `@nuxt/fonts` fetches the faces when the image is
built, so a release now needs network access, and one build in about ten has been
observed failing with a timeout that an immediate retry fixed. If your pipeline
cannot tolerate a retry, see the note in `apps/web/nuxt.config.ts` on switching
to `provider: 'local'`.

**If you serve uploads from S3**, uploaded fonts go there too, under a `fonts/`
prefix. Nothing to configure.

## Upgrading to 0.33 or later — federation is owner-only

Trackarr now distinguishes one account from the other administrators: the
**owner**. There is nothing to run and no variable to set — the migration marks
the oldest administrator account that is neither banned nor deleted, ordered by
signup date. On almost every instance that is the founding account.

**What changed hands.** Five federation routes moved from "any administrator" to
"the owner": turning federation on or off, adding a peer, approving one, editing
one, and removing one. Everything else about federation — the dashboard, the peer
list, the logs, reconciliation status — is still open to administrators. The
reason for the split is that a peer is a standing trust relationship with another
operator's database, which is a different kind of decision from moderating a
torrent.

If federation is off, nothing on your instance changes.

**If the wrong account was marked.** The owner can hand it over from the API:

```
POST /api/admin/owner/transfer   { "userId": "<another admin's id>" }
```

The recipient has to be an administrator, and the caller has to have entered
their password or passkey recently — the same freshness check the account-erasure
and 2FA routes use. Ownership is a single row: handing it over removes it from
the sender in the same transaction, and a partial unique index makes two owners
impossible to represent rather than merely unlikely.

**If the owner account goes away.** Erasing it or banning it moves ownership to
the oldest remaining eligible administrator, in the same transaction, so the
instance is never ownerless while an administrator exists. If none is eligible,
the flag stays where it is: an unreachable owner is recoverable — a nonexistent
one is not.

**Demoting the owner is refused**, and that is deliberate rather than an
oversight. If a demotion silently moved ownership to the oldest remaining
administrator, any administrator could take the instance by demoting the owner,
and the audit log would read as a routine role change. Transfer it first, then
demote.

## Upgrading to 0.27 or later — account secrets are encrypted at rest

**Nothing is required. One thing is strongly recommended.**

### What changed

`users.auth_verifier` and `users.totp_secret` are now encrypted at rest.

The verifier matters more than it looks: it is not a hash of the password, it
*is* the login credential. The handshake computes
`SHA256(auth_verifier ‖ challenge)` from the value stored in the row, so anyone
who could read that column could forge the proof for any account, with no
cracking step — and the TOTP seed sat in the clear beside it, which meant one
database dump defeated both factors at once.

### You do not have to do anything

Existing accounts keep working. A verifier written by an older version is
recognised as legacy plaintext, accepted, and rewritten encrypted the next time
its owner logs in successfully. There is no migration to run and no flag day.

The encryption key resolves from the first of:

1. `CREDENTIAL_ENCRYPTION_KEY`
2. `CHANNEL_ENCRYPTION_KEY`
3. `NUXT_SESSION_SECRET`

Since `NUXT_SESSION_SECRET` has always been required, an untouched deployment
already has a working key.

### What you should do: pin a dedicated key

```bash
echo "CREDENTIAL_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
```

Do this **before or during** the upgrade, not after — see the next section for
why the order matters.

Without it, your members' ability to log in is tied to `NUXT_SESSION_SECRET`.
That secret only ever invalidated session cookies, so rotating it was a routine,
harmless operation. From this version on, rotating it while it is also the
credential key makes every stored verifier undecryptable.

The API warns at boot when it is running on an inherited key.

### If the key changes anyway

The API refuses to start rather than serve a site that tells every member their
password is wrong. It exits with a message naming the recorded fingerprint, the
current one, and the three ways out:

1. **Restore the previous value** of whichever secret changed. This is the
   normal recovery and it is complete.
2. **Keep the new key** and set `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` to the old
   value. The API boots, reads existing rows with the old key, and rewrites each
   one under the new key as its owner logs in. Remove the variable once your
   members have all signed in — a month is a reasonable window on an active
   tracker.
3. **Accept the loss**, if the old value is genuinely gone: delete the
   `credential_key_check` row from `settings` to acknowledge it. Every member
   then has to reset their password and re-enrol TOTP.

`CREDENTIAL_ENCRYPTION_SALT` has the same one-way property. Leave it at its
default unless you are setting up a fresh instance.

## Upgrading to 0.27 or later — federation signature audience

Signed server-to-server requests now bind the recipient's `instanceId`, which
stops one partner replaying a signed request to another instance that trusts the
same sender.

Requests carry both the old and the new signature, so a mesh mid-upgrade keeps
working in both directions. Until every partner runs 0.27 or later, an attacker
can strip the new header and fall back to the old format. Once they all do, set:

```
FEDERATION_REQUIRE_AUDIENCE=true
```

Setting it while a partner is still on an older version breaks that link.

### The same flag now also covers relay countersignatures

A relay's countersignature — the "I am handing you this one" that lets a record
from an instance you do not federate with be taken in — used to name only the
record and the relay. It was therefore transferable: B's introduction to C
verified at D as well, so C could forward it and have the record admitted as
though B had handed it over.

It now binds the recipient too, and travels the same way the request signature
does: **both** forms go out on every relayed record (`relay` and
`relayAudience`), so a partner on any version keeps working. `unwrap` ignores
fields it does not know, which is what makes that true in the older direction.

One flag rather than a second one, because it is the same question — has every
partner upgraded — and two switches for one fact are two things to get out of
step.

The failure mode if you turn it on early is quieter here than on the request
signature, and worth knowing: a refused record is recorded as a rejected source,
so reconciliation stops asking for it. The partner's relayed catalogue simply
stops growing, with no error anywhere. Check `/admin/federation` shows every
peer on a current build first.

## Upgrading from 0.21.x

No required variable was added between 0.21 and 0.26. Two optional ones appeared
and both default to their previous behaviour:

| Variable | Default | Notes |
|---|---|---|
| `TRUST_CF_CONNECTING_IP` | `false` | Only enable behind Cloudflare with ingress locked to its ranges. |
| `SAFE_FETCH_ALLOW_HOSTS` | empty | Only needed to federate with a peer on a private network. |

Read the 0.27 sections above before pulling, then follow the standard path:
back up, pull, restart.
