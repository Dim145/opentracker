/**
 * GET /api/mod/dashboard
 *
 * Single fan-out call powering the moderator watchtower at /mod.
 * Returns five pieces of state needed to staff the queue:
 *
 *   • counts            — live totals for pending torrents,
 *                          pending reports, active H&R rows.
 *   • myStats           — the calling moderator's own activity
 *                          over the last 7 days.
 *   • recentPending     — the 5 freshest pending uploads, ready to
 *                          deep-link straight to their dossier.
 *   • recentActions     — last 10 status changes in the moderation
 *                          thread (any moderator), so the watchtower
 *                          shows what the team has been doing.
 *
 * Everything fans out via Promise.all so the handler's wall time is
 * dominated by the slowest single query, not their sum.
 */
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    pendingTorrentsRow,
    pendingReportsRow,
    activeHnrRow,
    myActionsRow,
    myReportsRow,
    recentPending,
    recentActions,
  ] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.torrents)
      .where(eq(schema.torrents.moderationStatus, 'pending')),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.reports)
      .where(eq(schema.reports.status, 'pending')),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.hnrTracking)
      .where(
        and(
          eq(schema.hnrTracking.isHnr, true),
          eq(schema.hnrTracking.isExempt, false),
        ),
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.torrentModerationMessages)
      .where(
        and(
          eq(schema.torrentModerationMessages.authorId, user.id),
          isNotNull(schema.torrentModerationMessages.statusChange),
          gt(schema.torrentModerationMessages.createdAt, sevenDaysAgo),
        ),
      ),

    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.reports)
      .where(
        and(
          eq(schema.reports.resolvedBy, user.id),
          gt(schema.reports.resolvedAt, sevenDaysAgo),
        ),
      ),

    db.query.torrents.findMany({
      where: eq(schema.torrents.moderationStatus, 'pending'),
      with: {
        uploader: { columns: { id: true, username: true } },
        category: { columns: { id: true, name: true } },
      },
      columns: {
        id: true,
        infoHash: true,
        name: true,
        size: true,
        createdAt: true,
      },
      orderBy: [desc(schema.torrents.createdAt)],
      limit: 5,
    }),

    db.query.torrentModerationMessages.findMany({
      where: isNotNull(schema.torrentModerationMessages.statusChange),
      with: {
        author: { columns: { id: true, username: true } },
        torrent: { columns: { id: true, infoHash: true, name: true } },
      },
      columns: {
        id: true,
        statusChange: true,
        createdAt: true,
      },
      orderBy: [desc(schema.torrentModerationMessages.createdAt)],
      limit: 10,
    }),
  ]);

  return {
    counts: {
      pendingTorrents: pendingTorrentsRow[0]?.count ?? 0,
      pendingReports: pendingReportsRow[0]?.count ?? 0,
      activeHnr: activeHnrRow[0]?.count ?? 0,
    },
    myStats: {
      actionsThisWeek: myActionsRow[0]?.count ?? 0,
      reportsClosedThisWeek: myReportsRow[0]?.count ?? 0,
    },
    me: {
      id: user.id,
      username: user.username,
    },
    recentPending,
    recentActions,
  };
});
