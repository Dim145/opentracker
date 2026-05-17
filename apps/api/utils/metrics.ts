/**
 * Prometheus metrics — exposed on a dedicated port (see plugins/metrics.ts).
 *
 * Two cost categories:
 *   - DB COUNT() and Redis INFO are cheap (a few ms) → recomputed on every
 *     scrape so Prometheus sees fresh data with the configured scrape
 *     interval (15s by default in most setups).
 *   - Redis SCAN over `peers:*` walks every active swarm key. On a healthy
 *     tracker that's hundreds-to-thousands of keys, each requiring an
 *     HGETALL — too expensive to do per scrape. We cache the SCAN result
 *     for `METRICS_PEER_CACHE_MS` (default 30s, slightly longer than a
 *     typical scrape) so a Prometheus burst doesn't repeatedly walk the
 *     keyspace.
 */
import {
  Registry,
  Gauge,
  collectDefaultMetrics,
  type MetricObjectWithValues,
} from 'prom-client';
import { db, schema } from '@trackarr/db';
import { sql, eq, isNull, and, or, gt, ne, lte } from 'drizzle-orm';
import { redis } from './server';
import { isInviteEnabled, isRegistrationOpen, getRequire2FAScope } from './settings';
import { rollupActivePeerCounts } from './peerStats';

const PEER_CACHE_MS = parseInt(
  process.env.METRICS_PEER_CACHE_MS || '30000',
  10
);

export const registry = new Registry();

// Default Node.js process metrics (cpu, heap, eventloop lag, gc, etc.).
collectDefaultMetrics({ register: registry, prefix: 'trackarr_' });

// `Gauge` config takes `registers: Registry[]`; `register` (singular) is
// silently ignored, which would route every gauge to prom-client's default
// global registry instead of our custom one. Spent an embarrassing amount
// of time staring at /metrics wondering where my counts went.
const labelMeta = { registers: [registry] } as const;

// ─── Business / content ──────────────────────────────────────────────────────

const usersTotal = new Gauge({
  name: 'trackarr_users_total',
  help: 'Total registered user accounts.',
  ...labelMeta,
});

const torrentsTotal = new Gauge({
  name: 'trackarr_torrents_total',
  help: 'Total torrents indexed.',
  ...labelMeta,
});

const torrentsBytesTotal = new Gauge({
  name: 'trackarr_torrents_bytes_total',
  help: 'Sum of all torrent sizes, in bytes.',
  ...labelMeta,
});

// ─── Swarm (Redis-derived) ───────────────────────────────────────────────────

const peersTotal = new Gauge({
  name: 'trackarr_peers_total',
  help: 'Unique active peers across the swarm (by ip:port). Cached for METRICS_PEER_CACHE_MS to bound scrape cost.',
  ...labelMeta,
});

const seedersTotal = new Gauge({
  name: 'trackarr_seeders_total',
  help: 'Unique active seeders across the swarm.',
  ...labelMeta,
});

const leechersTotal = new Gauge({
  name: 'trackarr_leechers_total',
  help: 'Unique active leechers (peers that are not seeders).',
  ...labelMeta,
});

// ─── Forum / community ───────────────────────────────────────────────────────

const forumTopicsTotal = new Gauge({
  name: 'trackarr_forum_topics_total',
  help: 'Total forum topics.',
  ...labelMeta,
});

const forumPostsTotal = new Gauge({
  name: 'trackarr_forum_posts_total',
  help: 'Total forum posts (including topic openers).',
  ...labelMeta,
});

// ─── Moderation / governance ─────────────────────────────────────────────────

const reportsPendingTotal = new Gauge({
  name: 'trackarr_reports_pending_total',
  help: "Reports in 'pending' status awaiting moderator review.",
  ...labelMeta,
});

const hnrActiveTotal = new Gauge({
  name: 'trackarr_hnr_active_total',
  help: 'Active hit-and-run tracking entries (not yet satisfied or expired).',
  ...labelMeta,
});

const invitationsPendingTotal = new Gauge({
  name: 'trackarr_invitations_pending_total',
  help: 'Unused, non-expired invitation codes.',
  ...labelMeta,
});

const bannedIpsTotal = new Gauge({
  name: 'trackarr_banned_ips_total',
  help: 'Banned IPs currently in the blocklist.',
  ...labelMeta,
});

// ─── Torrent moderation pipeline (since 0.10) ────────────────────────────────
//
// `trackarr_torrents_total` above stays as the grand-total count. The
// labelled gauge below splits the same population by moderation
// status so dashboards can plot the queue depth (pending +
// changes_requested) over time and spot a rejection spike.

const torrentsByStatus = new Gauge({
  name: 'trackarr_torrents_by_status',
  help: 'Torrents broken down by moderation status (pending/accepted/changes_requested/rejected). Sum equals trackarr_torrents_total.',
  labelNames: ['status'] as const,
  ...labelMeta,
});

const torrentModerationMessagesTotal = new Gauge({
  name: 'trackarr_torrent_moderation_messages_total',
  help: 'Posts on torrent moderation threads, labelled by author kind (system/staff/user).',
  labelNames: ['kind'] as const,
  ...labelMeta,
});

// ─── Users by role / status (since 0.10) ─────────────────────────────────────

const usersByRole = new Gauge({
  name: 'trackarr_users_by_role',
  help: 'User accounts by built-in role (admin/moderator/member). Each user counts in exactly one bucket — admins are not double-counted as moderators.',
  labelNames: ['role'] as const,
  ...labelMeta,
});

const usersBannedTotal = new Gauge({
  name: 'trackarr_users_banned_total',
  help: 'User accounts currently flagged is_banned (banned users still count in usersByRole — this gauge is a separate, overlapping view).',
  ...labelMeta,
});

// ─── 2FA enrolment (since 0.11) ──────────────────────────────────────────────

const usersTotpEnabledTotal = new Gauge({
  name: 'trackarr_users_totp_enabled_total',
  help: 'User accounts with TOTP-based 2FA enabled.',
  ...labelMeta,
});

const passkeysTotal = new Gauge({
  name: 'trackarr_passkeys_total',
  help: 'WebAuthn credentials registered across all users (one user may carry several).',
  ...labelMeta,
});

const usersWithPasskeyTotal = new Gauge({
  name: 'trackarr_users_with_passkey_total',
  help: 'Distinct user accounts that have at least one WebAuthn credential.',
  ...labelMeta,
});

const recoveryCodesUnusedTotal = new Gauge({
  name: 'trackarr_recovery_codes_unused_total',
  help: 'TOTP recovery codes still available (not yet redeemed). Drops to 0 when a user burns the whole batch.',
  ...labelMeta,
});

const trustedDevicesActiveTotal = new Gauge({
  name: 'trackarr_trusted_devices_active_total',
  help: 'Trusted-device cookies still within their TTL.',
  ...labelMeta,
});

const require2faScope = new Gauge({
  name: 'trackarr_require_2fa_scope',
  help: 'Forced-2FA enforcement scope. Exactly one label has value 1: off | staff | all.',
  labelNames: ['scope'] as const,
  ...labelMeta,
});

// ─── Invitations lifecycle (since 0.12) ──────────────────────────────────────
//
// `trackarr_invitations_pending_total` above is kept for backward
// compatibility with existing dashboards. The labelled gauge below
// adds the `used` / `expired` slices for richer breakdowns.

const invitationsByStatus = new Gauge({
  name: 'trackarr_invitations_by_status',
  help: 'Invitations by lifecycle bucket. pending = unused & not expired; used = redeemed; expired = unused but past expiresAt.',
  labelNames: ['status'] as const,
  ...labelMeta,
});

const registrationState = new Gauge({
  name: 'trackarr_registration_state',
  help: 'Registration mode. Exactly one label has value 1: open | invite_only | closed.',
  labelNames: ['mode'] as const,
  ...labelMeta,
});

// ─── Bonus events (Freeleech / Silverleech, since 0.12) ──────────────────────

const bonusEventsByStatus = new Gauge({
  name: 'trackarr_bonus_events_by_status',
  help: 'Bonus events by current state (active/scheduled/ended/disabled).',
  labelNames: ['status'] as const,
  ...labelMeta,
});

const bonusEventActive = new Gauge({
  name: 'trackarr_bonus_event_active',
  help: '1 if a bonus event is currently in flight, 0 otherwise.',
  ...labelMeta,
});

const bonusActiveDownloadMultiplier = new Gauge({
  name: 'trackarr_bonus_active_download_multiplier',
  help: 'Download multiplier of the currently active bonus event, expressed as a ratio (1.0 = identity, 0 = full freeleech, 0.5 = silverleech). Equals 1.0 when no event is active.',
  ...labelMeta,
});

const bonusActiveUploadMultiplier = new Gauge({
  name: 'trackarr_bonus_active_upload_multiplier',
  help: 'Upload multiplier of the currently active bonus event, as a ratio. Equals 1.0 when no event is active.',
  ...labelMeta,
});

const bonusEventActiveEndsAt = new Gauge({
  name: 'trackarr_bonus_event_active_ends_at_seconds',
  help: 'Unix epoch (seconds) at which the currently active bonus event ends. 0 when no event is active.',
  ...labelMeta,
});

// ─── Custom roles (since 0.11) ───────────────────────────────────────────────

const rolesTotal = new Gauge({
  name: 'trackarr_roles_total',
  help: 'Custom roles defined in the system, by assignment mode (manual/auto).',
  labelNames: ['assignment_mode'] as const,
  ...labelMeta,
});

const userRoleAssignmentsTotal = new Gauge({
  name: 'trackarr_user_role_assignments_total',
  help: 'Total user↔role attachments. Sums across users — one user with three roles counts three times.',
  ...labelMeta,
});

// ─── Torrent comments (since 0.10) ───────────────────────────────────────────

const torrentCommentsTotal = new Gauge({
  name: 'trackarr_torrent_comments_total',
  help: 'Comments posted on torrent detail pages.',
  ...labelMeta,
});

// ─── Anti-cheat (since 0.20) ─────────────────────────────────────────────────

const anticheatFlagsByKind = new Gauge({
  name: 'trackarr_anticheat_flags_by_kind',
  help: 'Anti-cheat flags raised by the tracker, by detection heuristic.',
  labelNames: ['kind'] as const,
  ...labelMeta,
});

const anticheatFlagsUnreviewedTotal = new Gauge({
  name: 'trackarr_anticheat_flags_unreviewed_total',
  help: 'Anti-cheat flags still awaiting moderator review (reviewed_at IS NULL). Effectively the queue depth at /mod/anti-cheat.',
  ...labelMeta,
});

// ─── Timed bans (since 0.20) ─────────────────────────────────────────────────

const usersBannedExpiringTotal = new Gauge({
  name: 'trackarr_users_banned_expiring_total',
  help: 'Banned users with a `banned_until` timestamp (timed bans, as opposed to permanent ones). Subset of trackarr_users_banned_total.',
  ...labelMeta,
});

const usersBannedExpiredPendingTotal = new Gauge({
  name: 'trackarr_users_banned_expired_pending_total',
  help: 'Timed bans whose `banned_until` has passed but the 5-min ban-expiry cron has not yet swept them. Steady-state should hover near zero; persistent values mean the cron is stuck.',
  ...labelMeta,
});

// ─── Social graph (since 0.20) ───────────────────────────────────────────────

const torrentFavoritesTotal = new Gauge({
  name: 'trackarr_torrent_favorites_total',
  help: 'Total per-user torrent stars across the catalogue.',
  ...labelMeta,
});

const userFollowsTotal = new Gauge({
  name: 'trackarr_user_follows_total',
  help: 'Total edges in the one-way follow graph.',
  ...labelMeta,
});

// ─── Cross-seed (since 0.19) ─────────────────────────────────────────────────

const torrentsWithSignatureTotal = new Gauge({
  name: 'trackarr_torrents_with_signature_total',
  help: 'Torrents that have a computed content_signature (drives the cross-seed surface). The backfill plugin populates legacy rows on boot.',
  ...labelMeta,
});

// ─── Upload requests / bounty board (since 0.20) ─────────────────────────────

const uploadRequestsByStatus = new Gauge({
  name: 'trackarr_upload_requests_by_status',
  help: 'Upload requests by lifecycle state (requested/filled/validated/cancelled). Sum is the all-time total.',
  labelNames: ['status'] as const,
  ...labelMeta,
});

const uploadRequestsRewardHeldTotal = new Gauge({
  name: 'trackarr_upload_requests_reward_held_total',
  help: 'Bonus points currently held in escrow across all open requests (status in requested or filled). Equals the sum the bounty board has on the hook.',
  ...labelMeta,
});

const uploadRequestFillAttemptsByStatus = new Gauge({
  name: 'trackarr_upload_request_fill_attempts_by_status',
  help: 'Fill attempts on upload requests, by status (proposed/rejected/validated).',
  labelNames: ['status'] as const,
  ...labelMeta,
});

const uploadRequestCommentsTotal = new Gauge({
  name: 'trackarr_upload_request_comments_total',
  help: 'Comments across every upload-request thread. Deleted rows still count — soft-delete keeps thread numbering stable.',
  ...labelMeta,
});

// ─── Notification routing (since 0.14) ───────────────────────────────────────

const notificationRoutingSubscribers = new Gauge({
  name: 'trackarr_notification_routing_subscribers',
  help: 'Distinct users routing at least one notification type to the given channel. The same user can route through several channels and is counted once per channel.',
  labelNames: ['channel'] as const,
  ...labelMeta,
});

// ─── Shop (since 0.14) ───────────────────────────────────────────────────────

const shopItemsByStatus = new Gauge({
  name: 'trackarr_shop_items_by_status',
  help: 'Bonus-shop catalogue, by availability. `enabled` = listed; `disabled` = hidden from the storefront.',
  labelNames: ['status'] as const,
  ...labelMeta,
});

const shopPurchasesTotal = new Gauge({
  name: 'trackarr_shop_purchases_total',
  help: 'Total successful shop purchases across all users (cumulative; never resets).',
  ...labelMeta,
});

// ─── Storage ─────────────────────────────────────────────────────────────────

const redisMemoryBytes = new Gauge({
  name: 'trackarr_redis_memory_bytes',
  help: 'Redis used memory in bytes (used_memory from INFO).',
  ...labelMeta,
});

const databaseSizeBytes = new Gauge({
  name: 'trackarr_database_size_bytes',
  help: 'PostgreSQL database size in bytes (pg_database_size).',
  ...labelMeta,
});

// ─── Swarm scan cache ────────────────────────────────────────────────────────

interface SwarmCounts {
  peers: number;
  seeders: number;
  leechers: number;
  collectedAt: number;
}

let cachedSwarm: SwarmCounts | null = null;
let swarmInflight: Promise<SwarmCounts> | null = null;

async function scanSwarmCounts(): Promise<SwarmCounts> {
  const SCAN_TIME_BUDGET_MS = 30_000;
  const counts = await rollupActivePeerCounts({
    deadline: Date.now() + SCAN_TIME_BUDGET_MS,
  });
  return { ...counts, collectedAt: Date.now() };
}

async function getSwarmCounts(): Promise<SwarmCounts> {
  const fresh =
    cachedSwarm && Date.now() - cachedSwarm.collectedAt < PEER_CACHE_MS;
  if (fresh) return cachedSwarm!;
  if (swarmInflight) return swarmInflight;

  swarmInflight = (async () => {
    try {
      const counts = await scanSwarmCounts();
      cachedSwarm = counts;
      return counts;
    } catch (err) {
      console.error('[metrics] swarm scan failed:', err);
      // Fall back to last known good values rather than zeroing the gauge,
      // which would create misleading dips on Prometheus dashboards.
      return (
        cachedSwarm ?? {
          peers: 0,
          seeders: 0,
          leechers: 0,
          collectedAt: Date.now(),
        }
      );
    } finally {
      swarmInflight = null;
    }
  })();

  return swarmInflight;
}

// ─── Refresh on scrape ──────────────────────────────────────────────────────

async function refreshGauges(): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  // Cheap: parallel COUNT(*) queries. drizzle returns [{ count }] each.
  const countQuery = (table: any, where?: any) => {
    const q = db
      .select({ count: sql<number>`count(*)::int` })
      .from(table);
    return where ? q.where(where) : q;
  };

  tasks.push(
    countQuery(schema.users).then((r) => usersTotal.set(r[0]?.count ?? 0))
  );

  tasks.push(
    db
      .select({
        count: sql<number>`count(*)::int`,
        bytes: sql<string>`coalesce(sum(size), 0)::text`,
      })
      .from(schema.torrents)
      .then((r) => {
        torrentsTotal.set(r[0]?.count ?? 0);
        torrentsBytesTotal.set(Number(r[0]?.bytes ?? 0));
      })
  );

  tasks.push(
    countQuery(schema.forumTopics).then((r) =>
      forumTopicsTotal.set(r[0]?.count ?? 0)
    )
  );

  tasks.push(
    countQuery(schema.forumPosts).then((r) =>
      forumPostsTotal.set(r[0]?.count ?? 0)
    )
  );

  tasks.push(
    countQuery(schema.reports, eq(schema.reports.status, 'pending')).then(
      (r) => reportsPendingTotal.set(r[0]?.count ?? 0)
    )
  );

  // Active = still required to seed (not satisfied, not exempt). Mirrors
  // how the HnR admin tab decides who's currently on the hook.
  tasks.push(
    countQuery(
      schema.hnrTracking,
      and(
        isNull(schema.hnrTracking.completedAt),
        ne(schema.hnrTracking.isExempt, true)
      )
    )
      .then((r) => hnrActiveTotal.set(r[0]?.count ?? 0))
      .catch(() => {
        // Tolerate schema drift; leave gauge at last value.
      })
  );

  tasks.push(
    countQuery(
      schema.invitations,
      and(
        isNull(schema.invitations.usedBy),
        or(
          isNull(schema.invitations.expiresAt),
          gt(schema.invitations.expiresAt, new Date())
        )
      )
    )
      .then((r) => invitationsPendingTotal.set(r[0]?.count ?? 0))
      .catch(() => {
        // Tolerate schema drift.
      })
  );

  tasks.push(
    countQuery(schema.bannedIps).then((r) =>
      bannedIpsTotal.set(r[0]?.count ?? 0)
    )
  );

  // Postgres database size.
  tasks.push(
    db
      .execute(sql`SELECT pg_database_size(current_database())::bigint AS size`)
      .then((rows: any) => {
        const v = Number(rows?.[0]?.size ?? 0);
        databaseSizeBytes.set(Number.isFinite(v) ? v : 0);
      })
  );

  // Redis memory.
  tasks.push(
    redis.info('memory').then((info) => {
      const m = info.match(/used_memory:(\d+)/);
      redisMemoryBytes.set(m ? parseInt(m[1]!, 10) : 0);
    })
  );

  // Swarm (cached SCAN).
  tasks.push(
    getSwarmCounts().then((s) => {
      peersTotal.set(s.peers);
      seedersTotal.set(s.seeders);
      leechersTotal.set(s.leechers);
    })
  );

  // ─── Torrents by moderation status ────────────────────────
  // One GROUP BY hits the index `torrents_moderation_status_idx`
  // and returns at most four rows. We initialise every label to 0
  // first so a status that drops to zero shows as `… 0` rather
  // than vanishing from the scrape.
  tasks.push(
    db
      .select({
        status: schema.torrents.moderationStatus,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.torrents)
      .groupBy(schema.torrents.moderationStatus)
      .then((rows) => {
        for (const s of ['pending', 'accepted', 'changes_requested', 'rejected']) {
          torrentsByStatus.set({ status: s }, 0);
        }
        for (const r of rows) {
          torrentsByStatus.set(
            { status: r.status as string },
            Number(r.count ?? 0)
          );
        }
      })
      .catch(() => {
        /* tolerate schema drift */
      })
  );

  // ─── Moderation messages by author kind ───────────────────
  // System messages → is_system = true. User vs staff requires a
  // join on the author's role flags; we run two cheap targeted
  // counts instead of a single GROUP BY so the SQL stays trivially
  // index-friendly.
  tasks.push(
    Promise.all([
      countQuery(
        schema.torrentModerationMessages,
        eq(schema.torrentModerationMessages.isSystem, true)
      ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.torrentModerationMessages)
        .innerJoin(
          schema.users,
          eq(schema.torrentModerationMessages.authorId, schema.users.id)
        )
        .where(
          and(
            eq(schema.torrentModerationMessages.isSystem, false),
            or(
              eq(schema.users.isAdmin, true),
              eq(schema.users.isModerator, true)
            )
          )
        ),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.torrentModerationMessages)
        .innerJoin(
          schema.users,
          eq(schema.torrentModerationMessages.authorId, schema.users.id)
        )
        .where(
          and(
            eq(schema.torrentModerationMessages.isSystem, false),
            eq(schema.users.isAdmin, false),
            eq(schema.users.isModerator, false)
          )
        ),
    ])
      .then(([sys, staff, user]) => {
        torrentModerationMessagesTotal.set(
          { kind: 'system' },
          sys[0]?.count ?? 0
        );
        torrentModerationMessagesTotal.set(
          { kind: 'staff' },
          staff[0]?.count ?? 0
        );
        torrentModerationMessagesTotal.set(
          { kind: 'user' },
          user[0]?.count ?? 0
        );
      })
      .catch(() => {
        /* tolerate schema drift */
      })
  );

  // ─── Users by role + ban count ────────────────────────────
  // Mutually exclusive buckets: admin > moderator > member.
  tasks.push(
    Promise.all([
      countQuery(schema.users, eq(schema.users.isAdmin, true)),
      countQuery(
        schema.users,
        and(eq(schema.users.isAdmin, false), eq(schema.users.isModerator, true))
      ),
      countQuery(
        schema.users,
        and(eq(schema.users.isAdmin, false), eq(schema.users.isModerator, false))
      ),
      countQuery(schema.users, eq(schema.users.isBanned, true)),
    ])
      .then(([admin, mod, member, banned]) => {
        usersByRole.set({ role: 'admin' }, admin[0]?.count ?? 0);
        usersByRole.set({ role: 'moderator' }, mod[0]?.count ?? 0);
        usersByRole.set({ role: 'member' }, member[0]?.count ?? 0);
        usersBannedTotal.set(banned[0]?.count ?? 0);
      })
      .catch(() => {
        /* tolerate schema drift */
      })
  );

  // ─── 2FA enrolment ────────────────────────────────────────
  tasks.push(
    countQuery(schema.users, eq(schema.users.totpEnabled, true))
      .then((r) => usersTotpEnabledTotal.set(r[0]?.count ?? 0))
      .catch(() => {})
  );
  tasks.push(
    countQuery(schema.webauthnCredentials)
      .then((r) => passkeysTotal.set(r[0]?.count ?? 0))
      .catch(() => {})
  );
  tasks.push(
    db
      .select({
        count: sql<number>`count(distinct ${schema.webauthnCredentials.userId})::int`,
      })
      .from(schema.webauthnCredentials)
      .then((r) => usersWithPasskeyTotal.set(r[0]?.count ?? 0))
      .catch(() => {})
  );
  tasks.push(
    countQuery(
      schema.recoveryCodes,
      isNull(schema.recoveryCodes.usedAt)
    )
      .then((r) => recoveryCodesUnusedTotal.set(r[0]?.count ?? 0))
      .catch(() => {})
  );
  tasks.push(
    countQuery(
      schema.trustedDevices,
      gt(schema.trustedDevices.expiresAt, new Date())
    )
      .then((r) => trustedDevicesActiveTotal.set(r[0]?.count ?? 0))
      .catch(() => {})
  );

  // ─── Invitations broken down by status ────────────────────
  tasks.push(
    Promise.all([
      // pending = unused, no expiry OR not yet expired
      countQuery(
        schema.invitations,
        and(
          isNull(schema.invitations.usedBy),
          or(
            isNull(schema.invitations.expiresAt),
            gt(schema.invitations.expiresAt, new Date())
          )
        )
      ),
      // used = redeemed
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.invitations)
        .where(sql`${schema.invitations.usedBy} is not null`),
      // expired = unused but past expiresAt
      countQuery(
        schema.invitations,
        and(
          isNull(schema.invitations.usedBy),
          lte(schema.invitations.expiresAt, new Date())
        )
      ),
    ])
      .then(([pending, used, expired]) => {
        invitationsByStatus.set({ status: 'pending' }, pending[0]?.count ?? 0);
        invitationsByStatus.set({ status: 'used' }, used[0]?.count ?? 0);
        invitationsByStatus.set({ status: 'expired' }, expired[0]?.count ?? 0);
      })
      .catch(() => {})
  );

  // ─── Bonus events ─────────────────────────────────────────
  tasks.push(
    db.query.bonusEvents
      .findMany({
        columns: {
          enabled: true,
          startsAt: true,
          endsAt: true,
          downloadMultiplier: true,
          uploadMultiplier: true,
        },
      })
      .then((rows) => {
        const now = Date.now();
        const buckets = {
          active: 0,
          scheduled: 0,
          ended: 0,
          disabled: 0,
        };
        let activeEvent: typeof rows[number] | null = null;
        for (const r of rows) {
          const startsMs = r.startsAt.getTime();
          const endsMs = r.endsAt.getTime();
          if (!r.enabled) {
            buckets.disabled++;
          } else if (endsMs <= now) {
            buckets.ended++;
          } else if (startsMs > now) {
            buckets.scheduled++;
          } else {
            buckets.active++;
            // Tie-break with most-recent createdAt is unnecessary here:
            // the API enforces "at most one active window" via the
            // overlap check + advisory lock. If the constraint ever
            // slipped we'd just publish whichever row landed last.
            activeEvent = r;
          }
        }
        for (const [status, count] of Object.entries(buckets)) {
          bonusEventsByStatus.set({ status }, count);
        }
        if (activeEvent) {
          bonusEventActive.set(1);
          bonusActiveDownloadMultiplier.set(
            activeEvent.downloadMultiplier / 100
          );
          bonusActiveUploadMultiplier.set(activeEvent.uploadMultiplier / 100);
          bonusEventActiveEndsAt.set(
            Math.floor(activeEvent.endsAt.getTime() / 1000)
          );
        } else {
          bonusEventActive.set(0);
          // Identity multipliers when no event is in flight — keeps
          // dashboards plotting "the multiplier applied to traffic
          // right now" without dropping to zero (= freeleech) when
          // nothing is active.
          bonusActiveDownloadMultiplier.set(1);
          bonusActiveUploadMultiplier.set(1);
          bonusEventActiveEndsAt.set(0);
        }
      })
      .catch(() => {})
  );

  // ─── Custom roles ─────────────────────────────────────────
  tasks.push(
    Promise.all([
      countQuery(
        schema.roles,
        eq(schema.roles.assignmentMode, 'manual')
      ),
      countQuery(
        schema.roles,
        eq(schema.roles.assignmentMode, 'auto')
      ),
      countQuery(schema.userRoles),
    ])
      .then(([manual, auto, attachments]) => {
        rolesTotal.set({ assignment_mode: 'manual' }, manual[0]?.count ?? 0);
        rolesTotal.set({ assignment_mode: 'auto' }, auto[0]?.count ?? 0);
        userRoleAssignmentsTotal.set(attachments[0]?.count ?? 0);
      })
      .catch(() => {})
  );

  // ─── Settings (registration / 2FA scope) ──────────────────
  // These are static-ish gauges: one of three labels carries 1,
  // the others carry 0. Setting all of them on every refresh
  // keeps Prometheus' current-value semantics correct even when
  // the operator flips the mode mid-window.
  tasks.push(
    Promise.all([isRegistrationOpen(), isInviteEnabled()])
      .then(([open, invite]) => {
        const mode = open ? 'open' : invite ? 'invite_only' : 'closed';
        for (const m of ['open', 'invite_only', 'closed']) {
          registrationState.set({ mode: m }, m === mode ? 1 : 0);
        }
      })
      .catch(() => {})
  );
  tasks.push(
    getRequire2FAScope()
      .then((scope) => {
        for (const s of ['off', 'staff', 'all']) {
          require2faScope.set({ scope: s }, s === scope ? 1 : 0);
        }
      })
      .catch(() => {})
  );

  // ─── Torrent comments ────────────────────────────────────
  tasks.push(
    countQuery(schema.torrentComments)
      .then((r) => torrentCommentsTotal.set(r[0]?.count ?? 0))
      .catch(() => {})
  );

  // ─── Anti-cheat ──────────────────────────────────────────
  tasks.push(
    db
      .select({
        kind: schema.anticheatFlags.kind,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.anticheatFlags)
      .groupBy(schema.anticheatFlags.kind)
      .then((rows) => {
        // Pre-seed the three known kinds so a dashboard stays
        // stable when none have fired recently.
        for (const k of ['velocity', 'no_leecher', 'unknown_client']) {
          anticheatFlagsByKind.set({ kind: k }, 0);
        }
        for (const r of rows) {
          anticheatFlagsByKind.set(
            { kind: r.kind as string },
            Number(r.count ?? 0)
          );
        }
      })
      .catch(() => {})
  );
  tasks.push(
    countQuery(
      schema.anticheatFlags,
      isNull(schema.anticheatFlags.reviewedAt)
    )
      .then((r) => anticheatFlagsUnreviewedTotal.set(r[0]?.count ?? 0))
      .catch(() => {})
  );

  // ─── Timed bans ──────────────────────────────────────────
  // banned_until is set → timed ban. We then split by whether
  // the timestamp is in the past (expired, waiting for cron) or
  // future (still active). Both subsets count in
  // trackarr_users_banned_total — these gauges are slices.
  tasks.push(
    Promise.all([
      countQuery(
        schema.users,
        and(
          eq(schema.users.isBanned, true),
          sql`${schema.users.bannedUntil} IS NOT NULL`
        )
      ),
      countQuery(
        schema.users,
        and(
          eq(schema.users.isBanned, true),
          lte(schema.users.bannedUntil, new Date())
        )
      ),
    ])
      .then(([timed, expired]) => {
        usersBannedExpiringTotal.set(timed[0]?.count ?? 0);
        usersBannedExpiredPendingTotal.set(expired[0]?.count ?? 0);
      })
      .catch(() => {})
  );

  // ─── Favorites + follows ─────────────────────────────────
  tasks.push(
    countQuery(schema.torrentFavorites)
      .then((r) => torrentFavoritesTotal.set(r[0]?.count ?? 0))
      .catch(() => {})
  );
  tasks.push(
    countQuery(schema.userFollows)
      .then((r) => userFollowsTotal.set(r[0]?.count ?? 0))
      .catch(() => {})
  );

  // ─── Cross-seed (signature backfill progress) ────────────
  tasks.push(
    countQuery(
      schema.torrents,
      sql`${schema.torrents.contentSignature} IS NOT NULL`
    )
      .then((r) => torrentsWithSignatureTotal.set(r[0]?.count ?? 0))
      .catch(() => {})
  );

  // ─── Upload requests / bounty board ──────────────────────
  tasks.push(
    Promise.all([
      db
        .select({
          status: schema.uploadRequests.status,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.uploadRequests)
        .groupBy(schema.uploadRequests.status),
      db
        .select({
          held: sql<string>`coalesce(sum(reward_points), 0)::text`,
        })
        .from(schema.uploadRequests)
        .where(
          or(
            eq(schema.uploadRequests.status, 'requested'),
            eq(schema.uploadRequests.status, 'filled')
          )
        ),
    ])
      .then(([byStatus, escrow]) => {
        for (const s of ['requested', 'filled', 'validated', 'cancelled']) {
          uploadRequestsByStatus.set({ status: s }, 0);
        }
        for (const r of byStatus) {
          uploadRequestsByStatus.set(
            { status: r.status as string },
            Number(r.count ?? 0)
          );
        }
        const held = Number(escrow[0]?.held ?? 0);
        uploadRequestsRewardHeldTotal.set(Number.isFinite(held) ? held : 0);
      })
      .catch(() => {})
  );
  tasks.push(
    db
      .select({
        status: schema.uploadRequestFillAttempts.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.uploadRequestFillAttempts)
      .groupBy(schema.uploadRequestFillAttempts.status)
      .then((rows) => {
        for (const s of ['proposed', 'rejected', 'validated']) {
          uploadRequestFillAttemptsByStatus.set({ status: s }, 0);
        }
        for (const r of rows) {
          uploadRequestFillAttemptsByStatus.set(
            { status: r.status as string },
            Number(r.count ?? 0)
          );
        }
      })
      .catch(() => {})
  );
  tasks.push(
    countQuery(schema.uploadRequestComments)
      .then((r) => uploadRequestCommentsTotal.set(r[0]?.count ?? 0))
      .catch(() => {})
  );

  // ─── Notification routing ────────────────────────────────
  // Count distinct subscribers per channel — same user routing
  // multiple types to one channel counts once. Initialises every
  // known channel type at 0 so a channel that lost its last
  // subscriber still shows as `… 0` on the dashboard.
  tasks.push(
    db
      .select({
        channel: schema.userNotificationRouting.channelType,
        count: sql<number>`count(distinct ${schema.userNotificationRouting.userId})::int`,
      })
      .from(schema.userNotificationRouting)
      .groupBy(schema.userNotificationRouting.channelType)
      .then((rows) => {
        for (const c of [
          'email',
          'telegram',
          'discord',
          'slack',
          'mattermost',
          'ntfy',
          'gotify',
          'pushover',
          'webhook',
          'apprise',
          'web_push',
        ]) {
          notificationRoutingSubscribers.set({ channel: c }, 0);
        }
        for (const r of rows) {
          notificationRoutingSubscribers.set(
            { channel: r.channel as string },
            Number(r.count ?? 0)
          );
        }
      })
      .catch(() => {})
  );

  // ─── Shop ────────────────────────────────────────────────
  tasks.push(
    Promise.all([
      countQuery(schema.shopItems, eq(schema.shopItems.enabled, true)),
      countQuery(schema.shopItems, eq(schema.shopItems.enabled, false)),
      countQuery(schema.shopPurchases),
    ])
      .then(([enabled, disabled, purchases]) => {
        shopItemsByStatus.set({ status: 'enabled' }, enabled[0]?.count ?? 0);
        shopItemsByStatus.set({ status: 'disabled' }, disabled[0]?.count ?? 0);
        shopPurchasesTotal.set(purchases[0]?.count ?? 0);
      })
      .catch(() => {})
  );

  // We don't want one slow / failed query to block the rest. allSettled
  // lets each gauge succeed or fail independently.
  await Promise.allSettled(tasks);
}

export async function getMetricsText(): Promise<string> {
  await refreshGauges();
  return registry.metrics();
}

export async function getMetricsContentType(): Promise<string> {
  return registry.contentType;
}

// Exported for tests / introspection.
export type { MetricObjectWithValues };
