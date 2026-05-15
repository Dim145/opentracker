/**
 * DELETE /api/me/reports/:id
 *
 * A reporter can withdraw a signalement they filed, but only while it
 * still sits in the moderation queue (`status = 'pending'`). Once a
 * moderator has acted on it the row becomes part of the audit trail —
 * accepted reports carry a cascade (torrent rejection, uploader
 * notification) that we are not going to unwind from here, and a
 * dismissed report is the kind of paper trail we want to keep so a
 * pattern of bad-faith reporting stays visible to staff.
 *
 * Hard delete (not a soft "withdrawn" status): the row exists purely
 * because the user asked us to look at it, and they're now asking us
 * to forget. Keeping a tombstone would just add a fourth status the
 * UI has to render without giving the user anything useful.
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Report ID required' });
  }

  const report = await db.query.reports.findFirst({
    where: eq(schema.reports.id, id),
    columns: { id: true, reporterId: true, status: true },
  });

  if (!report) {
    throw createError({ statusCode: 404, message: 'Report not found' });
  }

  // Ownership check + status check are returned as a single 404 on the
  // failure path so we don't leak the existence of someone else's
  // report through a 403 vs 404 split.
  if (report.reporterId !== user.id) {
    throw createError({ statusCode: 404, message: 'Report not found' });
  }

  if (report.status !== 'pending') {
    throw createError({
      statusCode: 409,
      message: 'Only pending reports can be cancelled',
    });
  }

  await db
    .delete(schema.reports)
    .where(
      and(
        eq(schema.reports.id, id),
        eq(schema.reports.reporterId, user.id),
        eq(schema.reports.status, 'pending'),
      ),
    );

  return { success: true };
});
