# Upgrading

Trackarr pushes its schema at boot (`drizzle-kit push --force` against
`schema.ts`), so an upgrade is normally: pull the new images, restart, done. No
migration to run by hand, no downtime window to plan beyond the restart itself.

This page records the upgrades that need more than that.

## Always

Take a database backup before pulling new images. See
[Backup & restore](./backup-restore.md). Everything below assumes you can roll
back.

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

## Upgrading from 0.21.x

No required variable was added between 0.21 and 0.26. Two optional ones appeared
and both default to their previous behaviour:

| Variable | Default | Notes |
|---|---|---|
| `TRUST_CF_CONNECTING_IP` | `false` | Only enable behind Cloudflare with ingress locked to its ranges. |
| `SAFE_FETCH_ALLOW_HOSTS` | empty | Only needed to federate with a peer on a private network. |

Read the 0.27 sections above before pulling, then follow the standard path:
back up, pull, restart.
