/**
 * GET /api/admin/bonus-events
 *
 * List every bonus-event row, newest first. The admin UI renders the
 * full list (including past windows) so an operator can see history,
 * re-enable an old preset, or clean up.
 */
import { db } from '@trackarr/db';
import { bonusEvents } from '@trackarr/db/schema';
import { desc } from 'drizzle-orm';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const rows = await db.query.bonusEvents.findMany({
    orderBy: [desc(bonusEvents.startsAt)],
  });

  const now = Date.now();
  return {
    events: rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      longDescription: r.longDescription,
      downloadMultiplier: r.downloadMultiplier,
      uploadMultiplier: r.uploadMultiplier,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      enabled: r.enabled,
      createdAt: r.createdAt.toISOString(),
      // Derived status helps the UI badge: scheduled / active / ended
      // / disabled. Keeping it server-side keeps the rendering rule in
      // one place.
      status: !r.enabled
        ? 'disabled'
        : r.endsAt.getTime() <= now
          ? 'ended'
          : r.startsAt.getTime() > now
            ? 'scheduled'
            : 'active',
    })),
  };
});
