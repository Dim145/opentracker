/**
 * DELETE /api/admin/bonus-events/:id
 *
 * Permanently remove a bonus event row. Past windows are kept by
 * default — deletion is a destructive admin action with no audit
 * trail beyond the operator's own records, so the UI confirms first.
 */
import { db } from '@trackarr/db';
import { bonusEvents } from '@trackarr/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdminSession } from '~~/utils/adminAuth';
import { syncActiveSnapshot } from '~~/utils/bonusEvents';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing id' });
  }

  // Refuse to delete a pool-managed event directly: a freeleech-pool
  // cycle references it via triggeredEventId, and deleting it out
  // from under the cycle leaves the cycle 'active' with a dangling
  // (null) event until its own ends_at (finding L8). Route the admin
  // to the pool's own reset action instead.
  const existing = await db.query.bonusEvents.findFirst({
    where: eq(bonusEvents.id, id),
    columns: { id: true, source: true },
  });
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Event not found' });
  }
  if (existing.source === 'freeleech_pool') {
    throw createError({
      statusCode: 409,
      message:
        'This event is managed by the freeleech pool. Use the pool reset action to stop it.',
    });
  }

  const [deleted] = await db
    .delete(bonusEvents)
    .where(eq(bonusEvents.id, id))
    .returning({ id: bonusEvents.id });

  if (!deleted) {
    throw createError({ statusCode: 404, message: 'Event not found' });
  }

  // The deleted row may have been the active one; recompute so the
  // tracker's snapshot doesn't keep applying its multipliers.
  await syncActiveSnapshot();

  return { success: true };
});
