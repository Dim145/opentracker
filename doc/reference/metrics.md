# Prometheus metrics

Trackarr exposes a Prometheus scrape endpoint on a **dedicated port** (default `9090`, path `/metrics`). The endpoint is intentionally separate from the public API so an operator can firewall it independently.

## Activation

| Env var                  | Default      | Purpose                                                     |
| ------------------------ | ------------ | ----------------------------------------------------------- |
| `METRICS_ENABLED`        | `false`      | Master switch. Set to `true`/`1`/`on` to bind the listener. |
| `METRICS_HOST`           | `0.0.0.0`    | Bind address.                                               |
| `METRICS_PORT`           | `9090`       | Bind port.                                                  |
| `METRICS_PATH`           | `/metrics`   | Scrape path.                                                |
| `METRICS_AUTH_TOKEN`     | unset        | When set, scrapes must present `Authorization: Bearer <token>` (constant-time compared). |
| `METRICS_PEER_CACHE_MS`  | `30000`      | TTL of the cached Redis SCAN over `peers:*` keys.           |

A `GET /healthz` and `GET /-/healthy` are also served on the same port for orchestrator probes.

## Reference

The collector pulls every gauge on each scrape (most are cheap COUNT(*) queries with `Promise.allSettled` so a slow query can't starve the rest). The Redis swarm SCAN is the only expensive operation and is cached for `METRICS_PEER_CACHE_MS`.

### Content & community

| Metric                                  | Type  | Labels    | What it tracks                                                                |
| --------------------------------------- | ----- | --------- | ----------------------------------------------------------------------------- |
| `trackarr_users_total`                  | gauge | —         | Total registered accounts.                                                    |
| `trackarr_torrents_total`               | gauge | —         | Total torrents indexed (every status, including rejected).                    |
| `trackarr_torrents_bytes_total`         | gauge | —         | Sum of `torrents.size` in bytes.                                              |
| `trackarr_forum_topics_total`           | gauge | —         | Forum topics.                                                                 |
| `trackarr_forum_posts_total`            | gauge | —         | Forum posts (including topic openers).                                        |

### Swarm (Redis-derived, cached)

| Metric                          | Type  | What it tracks                                |
| ------------------------------- | ----- | --------------------------------------------- |
| `trackarr_peers_total`          | gauge | Unique active peers across the swarm.         |
| `trackarr_seeders_total`        | gauge | Unique seeders.                               |
| `trackarr_leechers_total`       | gauge | Unique leechers (peers - seeders).            |

### Moderation pipeline

| Metric                                            | Labels                                                     |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `trackarr_torrents_by_status`                     | `status="pending\|accepted\|changes_requested\|rejected"`  |
| `trackarr_torrent_moderation_messages_total`      | `kind="system\|staff\|user"`                               |

The sum of `trackarr_torrents_by_status` equals `trackarr_torrents_total`.

### Users / governance

| Metric                                | Labels                                  |
| ------------------------------------- | --------------------------------------- |
| `trackarr_users_by_role`              | `role="admin\|moderator\|member"`       |
| `trackarr_users_banned_total`         | —                                       |
| `trackarr_roles_total`                | `assignment_mode="manual\|auto"`        |
| `trackarr_user_role_assignments_total`| —                                       |

### Two-factor auth adoption

| Metric                                | Type  | Notes                                                            |
| ------------------------------------- | ----- | ---------------------------------------------------------------- |
| `trackarr_users_totp_enabled_total`   | gauge | Accounts with `totp_enabled = true`.                             |
| `trackarr_passkeys_total`             | gauge | Total `webauthn_credentials` rows.                               |
| `trackarr_users_with_passkey_total`   | gauge | Distinct user ids carrying ≥1 passkey.                           |
| `trackarr_recovery_codes_unused_total`| gauge | Recovery codes with `used_at IS NULL`.                           |
| `trackarr_trusted_devices_active_total`| gauge | `trusted_devices` rows with `expires_at > now()`.                |
| `trackarr_require_2fa_scope`          | gauge | 1 on the active label, 0 on the others. `scope="off\|staff\|all"`. |

### Invitations

| Metric                                | Labels                                |
| ------------------------------------- | ------------------------------------- |
| `trackarr_invitations_pending_total`  | — (legacy, kept for back-compat)      |
| `trackarr_invitations_by_status`      | `status="pending\|used\|expired"`     |
| `trackarr_registration_state`         | `mode="open\|invite_only\|closed"` (1 on the active mode) |

### Bonus events

| Metric                                      | Type  | Notes                                                            |
| ------------------------------------------- | ----- | ---------------------------------------------------------------- |
| `trackarr_bonus_events_by_status`           | gauge | `status="active\|scheduled\|ended\|disabled"`.                   |
| `trackarr_bonus_event_active`               | gauge | `1` if a window is currently in flight, `0` otherwise.           |
| `trackarr_bonus_active_download_multiplier` | gauge | Ratio (1.0 = identity, 0 = freeleech, 0.5 = silverleech). 1.0 when no event. |
| `trackarr_bonus_active_upload_multiplier`   | gauge | Same units. 1.0 when no event.                                   |
| `trackarr_bonus_event_active_ends_at_seconds` | gauge | Unix epoch seconds. `0` when no event.                          |

### Storage / governance

| Metric                              | Type  | Notes                                            |
| ----------------------------------- | ----- | ------------------------------------------------ |
| `trackarr_reports_pending_total`    | gauge | Reports awaiting moderator review.               |
| `trackarr_hnr_active_total`         | gauge | Hit-and-run rows still on the hook.              |
| `trackarr_invitations_pending_total`| gauge | Unused, non-expired invitation codes.            |
| `trackarr_banned_ips_total`         | gauge | Banned IPs in the blocklist.                     |
| `trackarr_redis_memory_bytes`       | gauge | `used_memory` from Redis `INFO`.                 |
| `trackarr_database_size_bytes`      | gauge | `pg_database_size(current_database())`.          |

### Default Node.js metrics

`prom-client`'s default collector ships under the `trackarr_` prefix: CPU, heap usage, event-loop lag, GC pauses, etc. (Useful when you want to alert on Node-side trouble.)

## Example dashboard queries

```promql
# Moderation queue depth (excludes accepted + rejected)
sum by (status) (trackarr_torrents_by_status{status=~"pending|changes_requested"})

# 2FA adoption rate
trackarr_users_totp_enabled_total / trackarr_users_total
trackarr_users_with_passkey_total / trackarr_users_total

# Currently-applied multipliers (plot together; identity when no event)
trackarr_bonus_active_download_multiplier
trackarr_bonus_active_upload_multiplier

# Time until the active bonus event ends
trackarr_bonus_event_active_ends_at_seconds - time()
```
