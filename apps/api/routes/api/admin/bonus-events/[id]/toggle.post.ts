/**
 * POST /api/admin/bonus-events/:id/toggle
 *
 * Flip the `enabled` flag of a bonus event. When turning it back on
 * we re-run the overlap guard so the operator can't accidentally
 * stack two active windows by re-enabling an old row.
 */
import { db } from '@trackarr/db';
import { bonusEvents } from '@trackarr/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdminSession } from '~~/utils/adminAuth';
import { hasOverlap, syncActiveSnapshot } from '~~/utils/bonusEvents';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing id' });
  }

  const existing = await db.query.bonusEvents.findFirst({
    where: eq(bonusEvents.id, id),
  });
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Event not found' });
  }

  const next = !existing.enabled;

  if (next && (await hasOverlap(existing.startsAt, existing.endsAt, id))) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message:
        'Another enabled bonus event overlaps this time window. Disable the conflicting one before re-enabling this row.',
    });
  }

  const [updated] = await db
    .update(bonusEvents)
    .set({ enabled: next, updatedAt: new Date() })
    .where(eq(bonusEvents.id, id))
    .returning();

  await syncActiveSnapshot();

  return { event: updated };
});
