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
import {
  hasOverlap,
  lockBonusEventsForWrite,
  syncActiveSnapshot,
} from '~~/utils/bonusEvents';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing id' });
  }

  // Toggle = read + overlap check (only when re-enabling) + write,
  // gated by the bonus-events advisory lock to serialise with
  // concurrent POST/PATCH/toggle calls.
  const updated = await db.transaction(async (tx) => {
    await lockBonusEventsForWrite(tx);

    const existing = await tx.query.bonusEvents.findFirst({
      where: eq(bonusEvents.id, id),
    });
    if (!existing) {
      throw createError({ statusCode: 404, message: 'Event not found' });
    }

    const next = !existing.enabled;

    if (next && (await hasOverlap(existing.startsAt, existing.endsAt, id, tx))) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message:
          'Another enabled bonus event overlaps this time window. Disable the conflicting one before re-enabling this row.',
      });
    }

    const [row] = await tx
      .update(bonusEvents)
      .set({ enabled: next, updatedAt: new Date() })
      .where(eq(bonusEvents.id, id))
      .returning();
    return row;
  });

  await syncActiveSnapshot();

  return { event: updated };
});
