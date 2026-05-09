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
