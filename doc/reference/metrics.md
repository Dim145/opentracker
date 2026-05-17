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

### Timed bans

| Metric                                       | Type  | Notes                                                            |
| -------------------------------------------- | ----- | ---------------------------------------------------------------- |
| `trackarr_users_banned_expiring_total`       | gauge | Subset of banned users with a `banned_until` timestamp (timed bans). |
| `trackarr_users_banned_expired_pending_total`| gauge | Timed bans whose `banned_until` has passed but the 5-min cron hasn't swept yet. Sustained values mean the cron is stuck. |

### Anti-cheat

| Metric                                       | Type  | Labels                                              |
| -------------------------------------------- | ----- | --------------------------------------------------- |
| `trackarr_anticheat_flags_by_kind`           | gauge | `kind="velocity\|no_leecher\|unknown_client"`       |
| `trackarr_anticheat_flags_unreviewed_total`  | gauge | Queue depth at `/mod/anti-cheat`.                   |

### Social graph

| Metric                                       | Type  | Notes                                                       |
| -------------------------------------------- | ----- | ----------------------------------------------------------- |
| `trackarr_torrent_favorites_total`           | gauge | Per-user torrent stars across the catalogue.                |
| `trackarr_user_follows_total`                | gauge | Edges in the one-way follow graph.                          |
| `trackarr_torrent_comments_total`            | gauge | Comments posted on torrent detail pages.                    |

### Cross-seed

| Metric                                       | Type  | Notes                                                       |
| -------------------------------------------- | ----- | ----------------------------------------------------------- |
| `trackarr_torrents_with_signature_total`     | gauge | Torrents with a computed `content_signature`. Useful to track the backfill plugin's progress on a fresh install. |

### Upload requests (bounty board)

| Metric                                              | Type  | Labels / Notes                                                              |
| --------------------------------------------------- | ----- | --------------------------------------------------------------------------- |
| `trackarr_upload_requests_by_status`                | gauge | `status="requested\|filled\|validated\|cancelled"`. Sum = all-time total.   |
| `trackarr_upload_requests_reward_held_total`        | gauge | Bonus points held in escrow across open requests (status requested or filled). |
| `trackarr_upload_request_fill_attempts_by_status`   | gauge | `status="proposed\|rejected\|validated"`.                                   |
| `trackarr_upload_request_comments_total`            | gauge | Comments across every request thread (soft-deleted rows included).          |

### Notification routing

| Metric                                       | Type  | Labels                                                                       |
| -------------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| `trackarr_notification_routing_subscribers`  | gauge | `channel="email\|telegram\|discord\|slack\|mattermost\|ntfy\|gotify\|pushover\|webhook\|apprise\|web_push"`. Distinct subscribers per channel. |

### Bonus shop

| Metric                                       | Type  | Labels                                |
| -------------------------------------------- | ----- | ------------------------------------- |
| `trackarr_shop_items_by_status`              | gauge | `status="enabled\|disabled"`          |
| `trackarr_shop_purchases_total`              | gauge | Cumulative successful purchases.      |

### Freeleech pool

The contributory pool: members fund a shared pot until the target is hit, then a sitewide freeleech runs for the configured duration.

| Metric                                            | Type  | Labels / Notes                                                              |
| ------------------------------------------------- | ----- | --------------------------------------------------------------------------- |
| `trackarr_freeleech_pool_enabled`                 | gauge | `1` when the admin has the pool turned on, `0` otherwise.                   |
| `trackarr_freeleech_pool_points_current`          | gauge | Points contributed to the open cycle. `0` when no cycle is open.            |
| `trackarr_freeleech_pool_points_target`           | gauge | Target snapshot of the open cycle.                                          |
| `trackarr_freeleech_pool_progress_ratio`          | gauge | `current / target`, clamped to `[0, 1]`.                                    |
| `trackarr_freeleech_pool_state`                   | gauge | `state="filling\|full_queued\|active"`. `1` on the live one, `0` elsewhere. |
| `trackarr_freeleech_pool_contributors_total`      | gauge | Distinct contributors in the open cycle.                                    |
| `trackarr_freeleech_pool_cycles_completed_total`  | gauge | Cumulative cycles that ran to completion (`status = ended`).                |

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

# Anti-cheat queue health: spikes mean fresh fraud or a stuck mod team
trackarr_anticheat_flags_unreviewed_total

# Cron health: this should stay near 0 — sustained values mean the
# ban-expiry cron isn't sweeping (lock stuck, container unhealthy)
trackarr_users_banned_expired_pending_total

# Bounty board liquidity — how much real bonus mass is committed to
# open requests right now (held in escrow, not spendable elsewhere)
trackarr_upload_requests_reward_held_total

# Backfill progress (should approach trackarr_torrents_total on
# steady state):
trackarr_torrents_with_signature_total / trackarr_torrents_total

# Freeleech-pool fill ratio — pre-clamped 0..1 gauge, plots as a
# smooth ramp from 0% to 100% over the cycle:
trackarr_freeleech_pool_progress_ratio

# Live state of the pool (1 on exactly one label when a cycle is
# open, all zero when no cycle exists):
trackarr_freeleech_pool_state
```
