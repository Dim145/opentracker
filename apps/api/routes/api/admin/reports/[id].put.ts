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
 *                    the reporter as above AND, when the target is a
 *                    torrent, we cascade the action:
 *                      1. the torrent transitions to `rejected` using
 *                         the report reason as the rejection note,
 *                      2. the uploader receives an `upload_rejected`
 *                         notification (same channel a manual reject
 *                         would use),
 *                      3. the uploader's auto-roles get re-evaluated
 *                         since their approvedUploads count just
 *                         dropped.
 *                    The cascade saves the moderator one round-trip
 *                    and keeps the audit trail honest: the moderation
 *                    thread shows the rejection chained to the report.
 */
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { notify } from '~~/utils/notify';
import { transitionStatus } from '~~/utils/torrentModeration';
import { reevaluateUserRole } from '~~/utils/roleRules';

const resolveReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed']),
  resolution: z.string().max(500).optional(),
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
