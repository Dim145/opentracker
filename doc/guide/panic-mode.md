# Panic Mode

The **Panic Button** lets an administrator encrypt the tracker's most
damaging data in an emergency: every `.torrent` payload, the credentials
that authenticate members, and the written content of the forum and of
torrent comments.

::: warning It is not whole-database encryption
This page used to say "instantly encrypt all sensitive data" and "user data
is unreadable". That was wrong, and wrong in the direction that gets people
hurt — an operator could activate Panic Mode believing private messages and
2FA secrets were protected when they are not. See
[What gets encrypted](#what-gets-encrypted) for the exact boundary, both
halves of it. The live instance reports the same two lists from
`POST /api/admin/panic/encrypt`, so the answer can be checked against the
running code rather than against this page.
:::

## How It Works

```
┌───────────────────────────────────────────────────────────────────┐
│                       NORMAL STATE                                │
│  • Torrents downloadable                                          │
│  • User data readable                                             │
│  • Posts & comments visible                                       │
└───────────────────────────────────────────────────────────────────┘
                              │
                    PANIC ACTIVATED
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                      ENCRYPTED STATE                              │
│  • .torrent files → AES-256-GCM encrypted (unusable)              │
│  • Torrent names  → [ENCRYPTED]                                   │
│  • Torrent sizes  → 0                                             │
│  • User credentials → Encrypted                                   │
│  • Forum posts    → Encrypted                                     │
│  • Comments       → Encrypted                                     │
│                                                                   │
│  • Writes refused (503) until restored                            │
│                                                                   │
│  • Private messages, tickets, NFOs, IMDb/TMDb ids,                │
│    audit log, login history → UNTOUCHED, still readable           │
└───────────────────────────────────────────────────────────────────┘
                              │
                    RESTORE (with password)
                              │
                              ▼
┌───────────────────────────────────────────────────────────────────┐
│                       RESTORED STATE                              │
│  All data restored to original state                              │
└───────────────────────────────────────────────────────────────────┘
```

## Setup

### Setting the Panic Password

The **first administrator** must set a Panic Password during initial setup.

::: danger Critical
Without the Panic Password, encrypted data is **permanently lost**. There is no recovery mechanism, backdoor, or master key.
:::

## Activation

To activate Panic Mode:

1. Go to **Admin Settings** → **Panic Mode**
2. Confirm with the Panic Password

Encryption begins immediately. If it is cut short — a proxy timeout, a
restarted container — the instance stays in the `encrypting` phase with its
salt already saved: run **Encrypt** again and it resumes with the same key,
leaving the rows already done as they are. `GET /api/admin/panic` reports the
phase (`idle`, `encrypting`, `encrypted`, `restoring`); `isEncrypted` alone
stays false for the whole pass.

### While Panic Mode stands

From the moment the encrypt pass starts until a restore completes, the API is
**read-only**. Every `POST`, `PUT`, `PATCH` and `DELETE` is refused with `503`
and `{"reason": "panic-lock"}`, except the panic routes themselves (resuming
the encrypt pass, restoring) and logging out.

Sessions already open are not ended — on purpose, so that staff keep a way in
to restore. Before the lock, those sessions could go on uploading, posting,
registering members: every such row landed in clear in a database announced
as encrypted. Federation is suspended and the catalogue's background sweeps
pause over the same span. Another replica notices within five seconds; the
state is cached in Redis for that long.

## What Gets Encrypted

Both halves are listed, because only the two together describe what Panic
Mode buys you. They are the lists the API itself returns.

### Covered

| Column | What happens |
|--------|--------------|
| `torrents.torrent_data` | AES-256-GCM — the payload becomes unusable |
| `torrents.name` | Encrypted, or `[ENCRYPTED]` when empty |
| `torrents.description` | Encrypted |
| `torrents.size` | Set to `0` |
| `torrents.category_id` | Set to `NULL` |
| `users.auth_salt`, `users.auth_verifier` | Encrypted — logins stop working |
| `users.passkey` | Encrypted — announces stop working |
| `users.rss_key`, `users.api_key` | Encrypted — feeds and Torznab stop working |
| `users.last_ip` | Encrypted |
| `forum_posts.content` | Encrypted |
| `torrent_comments.content` | Encrypted |

### Left in cleartext

| Column | Why it matters |
|--------|----------------|
| `messages.body`, `room_messages.body` | Private conversations, in full |
| `tickets.*`, `ticket_messages.*` | Support threads, in full |
| `torrents.nfo`, `torrents.imdb_id` … `openlibrary_id` | They name the content as well as the encrypted title does |
| `catalog_records.body`, `work_titles.*` | The signed copy of each name and description, and the titles index |
| `users.bio`, `users.display_name` | Member-authored identity |
| `forum_topics.title` | The posts are encrypted; their titles are not |
| `reports.*`, `upload_requests.*`, `upload_request_comments.*` | What members flagged and asked for |
| `torrent_moderation_messages.*`, `user_warnings.*` | The moderation record |
| `banned_ips.*` | Addresses, and the reasons they were banned |
| `notifications.payload`, `saved_searches.*`, `search_misses.*` | What members were told and what they looked for |
| `messaging_broadcasts.*` | Staff announcements |
| `login_events.*` | Who connected, from where, when |
| `anticheat_flags.ip`, `anticheat_flags.user_agent` | Member IP addresses |
| `audit_log.*` | The administrative record |
| `remote_torrents.*` | Federated catalogue |

### Encrypted at rest, but not by the panic password

| Column | What protects it |
|--------|------------------|
| `users.totp_secret` | `CREDENTIAL_ENCRYPTION_KEY` |
| `notification_channels.server_config` | `CHANNEL_ENCRYPTION_KEY` |
| `federation_config.private_key_enc` | the channel key |

These were listed as cleartext until October 2026. They are out of reach of a
database dump alone, and within reach of whoever holds the server — its
environment carries the key.

### Outside the database

Panic Mode works on Postgres rows and nothing else:

- **Redis.** `peers:<info_hash>` keeps each peer's raw IP and member id for up
  to 24 h (`TRACKER_PEER_TTL`); the Torznab logs keep address, query and user
  agent for 7 days; the tracker caches passkeys for 60 s. The reference stack
  persists Redis to disk.
- **Postgres itself.** Dead tuples, the WAL and every backup taken before the
  panic still hold the rows in clear.
- **Proxy logs.** The reference Caddy configuration masks client addresses
  and drops the passkey, peer id and address parameters from what it logs —
  your own proxy may not.

Extending the covered half is a schema and restore-path change, not a
setting: every encrypted column needs its decrypt on the way back, and
`restore` has to stay able to bring an instance encrypted by an older
version back. Nothing here is a suggestion that Panic Mode is broken — it
is a statement of where its boundary currently sits.

## Restoration

To restore from Panic Mode:

1. Go to **Admin Settings** → **Panic Mode**
2. Enter the original Panic Password
3. Click **Restore**

The system will decrypt all data and return to normal operation.

If the restore stops part way — a timeout, a restarted container, a row that
will not decrypt — it keeps the salt and the `restoring` phase, and the API
stays read-only. Rows that fail are reported: `500` with their count and a
sample. Fix the cause and run it again. The rows a previous attempt already
restored are kept as they are, `.torrent` files included, and so is a row
that was in clear all along — written before the lock above existed.

## Encryption Details

| Component | Algorithm |
|-----------|-----------|
| Key Derivation | scrypt, 32-byte output, cost versioned (see below) |
| Encryption | AES-256-GCM |
| IV | 12 bytes random, **per field** — not per session |
| Authentication | GCM tag, 16 bytes (prevents tampering) |

The IV is 96 bits because that is the size AES-GCM is built around; the
16-byte IV used before was permitted but strictly worse, since the extra
bytes get folded into the tag derivation instead of being used as a nonce.
It is drawn fresh for every field, so two identical plaintexts do not
produce identical ciphertexts.

The scrypt cost is versioned rather than changed, so a database encrypted by
an older build stays restorable:

| `kdf_version` | Cost | Notes |
|---------------|------|-------|
| 1, 2 | N = 2^14, r = 8, p = 1 (~16 MB) | Node's defaults |
| 3 | N = 2^17, r = 8, p = 1 (~128 MB) | What new encryptions write |

Version 3 is what OWASP asks for a human-chosen password, and this is the
place it counts most: Panic Mode assumes the attacker already holds the salt
and the ciphertext, so the only thing standing between them and the data is
how long each guess takes. Measured on this codebase: ~50 ms per derivation
at version 1, ~490 ms at version 3.

## Use Cases

Panic Mode is designed for scenarios where data protection is paramount:

- **Server compromise** — Render stolen data useless
- **Shutdown** — Secure cleanup when closing the tracker
- etc.

## Best Practices

1. **Test restoration** — Practice the restore process BEFORE you need it
2. **Multiple backups** — Store the Panic Password in multiple secure locations
3. **Password managers** — Use a password manager for the Panic Password
