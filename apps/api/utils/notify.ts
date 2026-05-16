/**
 * Persistent notification emitter + SSE fanout.
 *
 * `notify(userId, type, payload, link?)` is the single entry point
 * every event source goes through:
 *
 *   1. Inserts a row in `notifications`.
 *   2. Publishes the row to `notifications:user:<userId>` on Redis.
 *      Every Nitro instance subscribed to that channel pushes the
 *      payload to the SSE clients it currently holds open.
 *
 * The Redis pub/sub layer is what makes the bell update across
 * Nitro replicas without sticky-session affinity: instance A
 * inserted the row, instance B has the user's SSE socket open,
 * both see the broadcast.
 *
 * Errors are swallowed (logged) — a missed notification must never
 * cascade into the calling business-logic path. The row still lands
 * in Postgres because the DB write happens before the broadcast.
 */
import { eq, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '@trackarr/db';
import { redis } from '../redis/client';
import {
  getNotificationsRetentionReadDays,
  getNotificationsRetentionUnreadDays,
} from './settings';

/**
 * Stable event keys. Adding a new key here gives a single place to
 * trace the surface; the frontend resolves each key to a localised
 * label under `notifications.types.<key>`.
 *
 * Grouping mirrors the v1 scope: P1 = "user would be upset if they
 * missed it" (moderation lifecycle, admin actions, security). P2 =
 * "user wants to know" (social, bonus economy, invitations).
 */
export type NotificationType =
  // ── P1 — Moderation lifecycle ──────────────────────────────
  | 'upload_accepted'
  | 'upload_rejected'
  | 'upload_changes_requested'
  | 'upload_reset'
  | 'moderation_message_received'
  | 'torrent_deleted_by_staff'
  // ── P1 — Hit & Run ─────────────────────────────────────────
  | 'hnr_violation_marked'
  | 'hnr_cleared'
  | 'hnr_exempted'
  // ── P1 — Admin actions on the user's account ───────────────
  | 'account_banned'
  | 'account_unbanned'
  | 'role_attached_manually'
  | 'role_detached'
  | 'staff_status_changed'
  | 'bonus_points_adjusted'
  // ── P1 — Security ──────────────────────────────────────────
  | 'password_changed'
  | 'totp_enabled'
  | 'totp_disabled'
  | 'passkey_added'
  | 'passkey_removed'
  | 'recovery_codes_regenerated'
  | 'recovery_code_used'
  | 'login_new_ip'
  // ── P2 — Social ────────────────────────────────────────────
  | 'comment_on_my_upload'
  | 'forum_reply_on_my_topic'
  | 'comment_deleted_by_staff'
  | 'forum_post_deleted_by_staff'
  // ── P2 — Bonus economy ─────────────────────────────────────
  | 'bonus_event_started'
  | 'first_seeder_reward'
  | 'seeding_milestone_reached'
  // ── P2 — Social graph ──────────────────────────────────────
  // Fired when an upload by someone the recipient follows reaches
  // `accepted` — either auto-approved at upload time or via a
  // moderator's later acceptance. The follow target is never
  // notified of the relationship itself; the only social signal
  // the graph emits is this one upload-arrival ping.
  | 'followed_user_upload'
  // ── P2 — Invitations ───────────────────────────────────────
  | 'invite_redeemed'
  | 'invitee_banned'
  // ── P2 — Moderator-as-recipient ────────────────────────────
  | 'new_pending_upload'
  | 'new_report_filed'
  | 'report_actioned'
  // ── P2 — Security (soft) ───────────────────────────────────
  | 'trusted_device_added';

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  payload: Record<string, unknown> | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/**
 * Redis pub/sub channel a given user's notifications stream on.
 * The SSE handler subscribes to this channel when a client opens
 * the stream, and the emitter publishes here at the end of every
 * `notify()` call.
 */
export const NOTIFY_CHANNEL_PREFIX = 'notifications:user:';
export const channelFor = (userId: string) =>
  `${NOTIFY_CHANNEL_PREFIX}${userId}`;

/**
 * Emit a notification. Returns the inserted row id (or `null` on
 * failure — the caller never blocks on this so we don't surface
 * the error as an exception).
 *
 * `payload` should carry enough context for the frontend to render
 * the row without an extra round-trip — e.g. for `upload_accepted`
 * include `{ torrentName }` so the dropdown can show the title.
 */
export async function notify(
  userId: string,
  type: NotificationType,
  payload?: Record<string, unknown> | null,
  link?: string | null,
): Promise<string | null> {
  if (!userId) return null;
  const id = uuidv4();
  try {
    await db.insert(schema.notifications).values({
      id,
      userId,
      type,
      payload: payload ?? null,
      link: link ?? null,
    });
  } catch (err) {
    console.warn('[Notify] insert failed', {
      userId,
      type,
      err: (err as Error).message,
    });
    return null;
  }

  // Broadcast on Redis so any Nitro replica with the user's SSE
  // stream open can push the row. Falls back silently — the next
  // poll-on-reconnect (or a manual refresh of the page) will pick
  // it up.
  const record: NotificationRecord = {
    id,
    userId,
    type,
    payload: payload ?? null,
    link: link ?? null,
    readAt: null,
    createdAt: new Date().toISOString(),
  };
  try {
    await redis.publish(channelFor(userId), JSON.stringify(record));
  } catch (err) {
    console.warn('[Notify] publish failed (row already persisted)', {
      userId,
      type,
      err: (err as Error).message,
    });
  }

  // Third fan-out: external channels (SMTP / Telegram / Discord / …).
  // Fire-and-forget so a slow upstream never blocks the route handler
  // that originally called `notify()`. The dispatcher loads the user's
  // routing rows, picks the matching channel, and writes back the
  // delivery state for the circuit breaker.
  void deliverToExternalChannels(userId, type, payload ?? null, link ?? null);

  return id;
}

/**
 * External-channel fan-out. Looks up the user's routing for this
 * notif type and, if a row exists, dispatches through the matching
 * channel. Each delivery is independent — one failing channel never
 * blocks the others (we don't even have "others" today since the
 * model is one-channel-per-type, but the parallelism is cheap to
 * keep around for the day we relax that constraint).
 *
 * The function is intentionally non-throwing: any error gets folded
 * into the circuit-breaker counter via `recordFailure`, never
 * surfaced to the caller. `notify()` is best-effort by contract.
 */
async function deliverToExternalChannels(
  userId: string,
  type: NotificationType,
  payload: Record<string, unknown> | null,
  link: string | null
): Promise<void> {
  try {
    // Lazy imports break a potential cycle with `channels/index.ts`
    // (which in turn imports `notify.ts`'s `NotificationType` only).
    const [
      { db: localDb, schema: localSchema },
      { and: andOp, eq: eqOp },
      { sendThroughChannel },
      { renderNotification },
      { consumeRateBudget, recordFailure, recordSuccess },
    ] = await Promise.all([
      import('@trackarr/db'),
      import('drizzle-orm'),
      import('./channels'),
      import('./notifyRenderer'),
      import('./channelGuard'),
    ]);

    const routing = await localDb.query.userNotificationRouting.findFirst({
      where: andOp(
        eqOp(localSchema.userNotificationRouting.userId, userId),
        eqOp(localSchema.userNotificationRouting.type, type)
      ),
    });
    if (!routing) return; // no external delivery configured for this type

    // User-channel + admin-channel rows are independent — fetch them in
    // parallel along with the user locale lookup so a fan-out
    // notification (notifyMany to N staff members) doesn't serialise
    // three round-trips per recipient.
    const [userRow, adminRow, userRec] = await Promise.all([
      localDb.query.userNotificationChannels.findFirst({
        where: andOp(
          eqOp(localSchema.userNotificationChannels.userId, userId),
          eqOp(
            localSchema.userNotificationChannels.channelType,
            routing.channelType
          )
        ),
      }),
      localDb.query.notificationChannels.findFirst({
        where: eqOp(localSchema.notificationChannels.type, routing.channelType),
      }),
      localDb.query.users.findFirst({
        where: eqOp(localSchema.users.id, userId),
        columns: { language: true },
      }),
    ]);
    if (!userRow || !userRow.enabled) return;
    if (!adminRow || !adminRow.enabled) return;
    if (adminRow.lastTestStatus !== 'ok') return;
    const locale = userRec?.language ?? 'en';
    const { title, body } = renderNotification(type, payload, locale);

    const budget = await consumeRateBudget(userId, routing.channelType);
    if (!budget.allowed) {
      console.warn(
        `[Notify] rate-limited user=${userId} channel=${routing.channelType}; retry in ${budget.retryAfterS}s`
      );
      return;
    }

    const result = await sendThroughChannel(userId, routing.channelType, {
      type,
      title,
      body,
      link,
      meta: payload ?? {},
    });

    if (result.ok) {
      await recordSuccess(userRow.id);
    } else {
      await recordFailure(
        userRow.id,
        userId,
        routing.channelType,
        result.error
      );
    }
  } catch (err) {
    console.warn('[Notify] external dispatch failed', {
      userId,
      type,
      err: (err as Error).message,
    });
  }
}

/**
 * Fan-out helper for events that hit a group of users (e.g.
 * `new_pending_upload` → every mod/admin). Walks the recipients
 * in parallel — each insert + publish runs independently so one
 * bad row doesn't drop the rest.
 */
export async function notifyMany(
  userIds: string[],
  type: NotificationType,
  payload?: Record<string, unknown> | null,
  link?: string | null,
): Promise<void> {
  if (userIds.length === 0) return;
  await Promise.allSettled(
    userIds.map((uid) => notify(uid, type, payload, link)),
  );
}

/**
 * Resolve the list of users to notify for "mod-as-recipient" events.
 * Caches at the request level via a tiny in-memory Map keyed on the
 * event's nonce — moderation events typically don't fire more than
 * once per request so a simple read-through cache buys us one DB
 * round-trip per emission.
 */
export async function listStaffRecipients(): Promise<string[]> {
  const rows = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(
      sql`(${schema.users.isAdmin} = true OR ${schema.users.isModerator} = true) AND ${schema.users.isBanned} = false`,
    );
  return rows.map((r) => r.id);
}

/**
 * Retention sweep — run from the cron plugin. Hard-deletes rows
 * past their type-specific TTL (read vs unread). Two settings keys
 * drive the policy:
 *   - `notifications_retention_read_days`   — read rows older than this
 *   - `notifications_retention_unread_days` — unread rows older than this
 * Both default to 90.
 */
export async function sweepNotificationsRetention(): Promise<{
  deletedRead: number;
  deletedUnread: number;
}> {
  const readDays = await getNotificationsRetentionReadDays();
  const unreadDays = await getNotificationsRetentionUnreadDays();

  const readCutoff = new Date(Date.now() - readDays * 86_400_000);
  const unreadCutoff = new Date(Date.now() - unreadDays * 86_400_000);

  const deletedRead = await db.execute(
    sql`DELETE FROM ${schema.notifications}
        WHERE read_at IS NOT NULL AND created_at < ${readCutoff}
        RETURNING id`,
  );
  const deletedUnread = await db.execute(
    sql`DELETE FROM ${schema.notifications}
        WHERE read_at IS NULL AND created_at < ${unreadCutoff}
        RETURNING id`,
  );

  // drizzle's `db.execute` returns a result shape that depends on
  // the underlying driver; we read `rowCount` defensively.
  const rc = (r: any): number =>
    typeof r?.rowCount === 'number'
      ? r.rowCount
      : Array.isArray(r?.rows)
        ? r.rows.length
        : 0;

  return {
    deletedRead: rc(deletedRead),
    deletedUnread: rc(deletedUnread),
  };
}

/** Mark a single notification as read; idempotent. */
export async function markNotificationRead(
  userId: string,
  notificationId: string,
): Promise<boolean> {
  const result = await db.execute(
    sql`UPDATE ${schema.notifications}
        SET read_at = NOW()
        WHERE id = ${notificationId}
          AND user_id = ${userId}
          AND read_at IS NULL`,
  );
  const rc =
    typeof (result as any)?.rowCount === 'number'
      ? (result as any).rowCount
      : 0;
  return rc > 0;
}

/** Mark every unread notification of the user as read. */
export async function markAllNotificationsRead(
  userId: string,
): Promise<number> {
  const result = await db.execute(
    sql`UPDATE ${schema.notifications}
        SET read_at = NOW()
        WHERE user_id = ${userId} AND read_at IS NULL`,
  );
  const rc =
    typeof (result as any)?.rowCount === 'number'
      ? (result as any).rowCount
      : 0;
  return rc;
}

export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await db.execute<{ c: number }>(
    sql`SELECT COUNT(*)::int AS c FROM ${schema.notifications}
        WHERE user_id = ${userId} AND read_at IS NULL`,
  );
  const out = (rows as any)?.rows?.[0] ?? (rows as any)?.[0];
  return Number(out?.c ?? 0);
}
