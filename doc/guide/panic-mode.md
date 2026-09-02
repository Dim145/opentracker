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
│  • Private messages, tickets, 2FA secrets,                        │
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

Encryption begins immediately and cannot be interrupted.

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
| `users.totp_secret` | A 2FA secret is enough to mint valid codes |
| `federation_config.private_key` | The instance's own signing key |
| `users.bio`, `users.display_name` | Member-authored identity |
| `forum_topics.title` | The posts are encrypted; their titles are not |
| `notification_channels.server_config` | Webhook URLs and channel credentials |
| `login_events.*` | Who connected, from where, when |
| `anticheat_flags.ip`, `anticheat_flags.user_agent` | Member IP addresses |
| `audit_log.*` | The administrative record |
| `remote_torrents.*` | Federated catalogue |

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
