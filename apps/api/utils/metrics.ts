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
