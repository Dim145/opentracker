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
 * This used to hard-delete, on the reasoning that the user asked us to
 * forget and a tombstone would only add a status the UI must render for
 * no user benefit. The first half still holds and the second was the
 * mistake: the tombstone is not for the reporter. Filing and pulling
 * reports in series is exactly the pattern staff need to see, and a
 * deleted row makes it invisible. So the report leaves the reporter's
 * own list — from their side it is gone — and stays counted against
 * them in moderation.
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

  // UPDATE conditionnel sur le statut : deux retraits concurrents, ou un
  // modérateur qui traite le signalement pendant que l'utilisateur le retire,
  // ne peuvent pas se marcher dessus.
  await db
    .update(schema.reports)
    .set({ status: 'withdrawn', withdrawnAt: new Date() })
    .where(
      and(
        eq(schema.reports.id, id),
        eq(schema.reports.reporterId, user.id),
        eq(schema.reports.status, 'pending'),
      ),
    );

  return { success: true };
});
