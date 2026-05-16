/**
 * PUT /api/admin/reports/:id
 *
 * Moderator-side resolution of a report.
 *
 * Two outcomes:
 *   - `dismissed`  : the moderator judged the report invalid. The
 *                    reporter is notified via `report_actioned` so the
 *                    submission doesn't feel like it went into a void.
 *
 *   - `resolved`   : the moderator agreed with the report. We notify
 *                    the reporter as above AND, depending on
 *                    `targetType`, we cascade the action:
 *
 *                    * torrent — the row transitions to `rejected`
 *                      using the report reason as the rejection note,
 *                      the uploader is notified via `upload_rejected`,
 *                      and their auto-roles are re-evaluated.
 *
 *                    * user — when the moderator picked a
 *                      `banDuration` other than `'none'`, the offender
 *                      is banned in the same transaction. The ban
 *                      carries the duration (`bannedUntil`) and a
 *                      reason that the user sees on their bounce
 *                      screen. Hierarchy follows the dedicated
 *                      `POST /admin/users/:id/ban` rules so a
 *                      moderator can't escalate a peer.
 *
 *                    The cascade saves the moderator one round-trip
 *                    and keeps the audit trail honest: the moderation
 *                    thread shows the action chained to the report.
 */
import { db, schema } from '@trackarr/db';
import { requireModeratorSession, invalidateBanCache } from '~~/utils/adminAuth';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { notify } from '~~/utils/notify';
import { transitionStatus } from '~~/utils/torrentModeration';
import { reevaluateUserRole } from '~~/utils/roleRules';
import { computeBannedUntil } from '~~/utils/banDuration';

const resolveReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
  resolution: z.string().max(500).optional(),
  // When `targetType === 'user'` and the moderator clicked "Resolve
  // with sanction", a duration is sent alongside. Omitting the field
  // (or sending `'none'`) keeps the existing "resolve, no sanction"
  // behaviour. Listed explicitly so Zod gets a non-empty literal
  // tuple — spreading `BAN_DURATIONS` would widen to `string`.
  banDuration: z.enum(['none', '1d', '7d', '1m', '1y', 'permanent']).optional(),
  // Free-text reason shown on the banned user's bounce screen.
  // Defaults to the report's own `reason` when omitted, so a
  // hurried mod still gets a sensible message attached.
  banReason: z.string().max(500).optional(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Report ID required' });
  }

  const body = await readBody(event);
  const data = resolveReportSchema.parse(body);

  const report = await db.query.reports.findFirst({
    where: eq(schema.reports.id, id),
  });

  if (!report) {
    throw createError({ statusCode: 404, message: 'Report not found' });
  }

  // Validate the ban path BEFORE we touch the report row. Failing
  // half-way through (report marked resolved, ban refused) would
  // leave the moderator confused about what actually happened.
  const wantsBan =
    data.status === 'resolved' &&
    data.banDuration !== undefined &&
    data.banDuration !== 'none';

  if (wantsBan && report.targetType !== 'user') {
    throw createError({
      statusCode: 400,
      message: 'Ban duration only applies to user reports',
    });
  }

  let banTarget: schema.User | null = null;
  if (wantsBan) {
    banTarget = (await db.query.users.findFirst({
      where: eq(schema.users.id, report.targetId),
    })) ?? null;
    if (!banTarget) {
      throw createError({
        statusCode: 404,
        message: 'Reported user no longer exists',
      });
    }
    if (user.id === banTarget.id) {
      throw createError({ statusCode: 400, message: 'You cannot ban yourself' });
    }
    if (banTarget.isAdmin) {
      throw createError({ statusCode: 403, message: 'Cannot ban an admin' });
    }
    if (banTarget.isModerator && !user.isAdmin) {
      throw createError({
        statusCode: 403,
        message: 'Only admins can ban a moderator',
      });
    }
  }

  const updated = await db
    .update(schema.reports)
    .set({
      status: data.status,
      resolution: data.resolution || null,
      resolvedBy: user.id,
      resolvedAt: new Date(),
    })
    .where(eq(schema.reports.id, id))
    .returning();

  // ── Cascade: accepted torrent report → reject the torrent ──
  if (data.status === 'resolved' && report.targetType === 'torrent') {
    const torrent = await db.query.torrents.findFirst({
      where: eq(schema.torrents.id, report.targetId),
      columns: { id: true, infoHash: true, name: true, uploaderId: true },
    });
    if (torrent) {
      // Compose the rejection note for the moderation thread. The
      // "Report accepted:" prefix makes the cascade visible at a
      // glance in the audit history; the moderator's resolution note
      // (if present) carries extra context.
      const noteLines = [`Report accepted: ${report.reason}`];
      if (data.resolution) noteLines.push(`Moderator note: ${data.resolution}`);
      const noteBody = noteLines.join('\n\n');

      const rejectedTorrent = await transitionStatus({
        torrentId: torrent.id,
        nextStatus: 'rejected',
        actorId: user.id,
        body: noteBody,
      });

      if (rejectedTorrent.uploaderId) {
        // Sweep the uploader's auto-roles — same as a manual reject.
        void reevaluateUserRole(rejectedTorrent.uploaderId).catch((err) => {
          console.error('[Roles] post-report-reject sweep failed:', err);
        });

        // Notify the uploader via the same `upload_rejected` channel
        // that a manual reject would use, so the inbox semantics stay
        // consistent regardless of how the rejection was triggered.
        void notify(
          rejectedTorrent.uploaderId,
          'upload_rejected',
          {
            torrentName: rejectedTorrent.name,
            moderatorUsername: user.username,
            message: noteBody,
          },
          `/torrents/${torrent.infoHash}`,
        );
      }
    }
  }

  // ── Cascade: accepted user report → ban the offender ──────
  if (wantsBan && banTarget) {
    const duration = data.banDuration as Exclude<
      NonNullable<typeof data.banDuration>,
      'none'
    >;
    const bannedUntil = computeBannedUntil(duration);
    const reasonText =
      data.banReason?.trim() ||
      data.resolution?.trim() ||
      report.reason;

    await db
      .update(schema.users)
      .set({
        isBanned: true,
        bannedById: user.id,
        bannedByRole: user.isAdmin ? 'admin' : 'moderator',
        bannedUntil,
        banReason: reasonText,
      })
      .where(eq(schema.users.id, banTarget.id));

    // Drop the cached `isBanned` so the next request from the
    // offender (any surface) sees the lockout immediately.
    await invalidateBanCache(banTarget.id);

    // Notify the banned user. They won't see it until their next
    // login (auth middleware blocks the session) — but it'll sit
    // in their inbox alongside the eventual unban notification.
    void notify(banTarget.id, 'account_banned', {
      reason: reasonText,
      actorUsername: user.username,
      duration,
      bannedUntil: bannedUntil ? bannedUntil.toISOString() : null,
    });

    // Inviter notification — same pattern as the admin ban
    // endpoint. Note: the invitations schema uses `createdBy`,
    // not `generatedBy`; the older admin ban code references
    // `generatedBy` and silently no-ops on missing field.
    try {
      const invite = await db.query.invitations.findFirst({
        where: (i, { eq }) => eq(i.usedBy, banTarget.id),
        columns: { createdBy: true, code: true },
      });
      if (invite?.createdBy && invite.createdBy !== user.id) {
        void notify(invite.createdBy, 'invitee_banned', {
          inviteeUsername: banTarget.username,
          inviteCode: invite.code,
          reason: reasonText,
        });
      }
    } catch (err) {
      console.warn(
        '[Reports] invitee notify failed:',
        (err as Error).message,
      );
    }
  }

  // ── Reporter notification (both dismiss + resolve) ────────
  // Skip if the staffer was also the reporter (unusual but possible).
  if (report.reporterId && report.reporterId !== user.id) {
    void notify(
      report.reporterId,
      'report_actioned',
      {
        status: data.status,
        resolution: data.resolution ?? null,
        targetType: report.targetType,
        reason: report.reason,
      },
      null,
    );
  }

  return updated[0];
});
