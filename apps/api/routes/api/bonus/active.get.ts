/**
 * GET /api/bonus/active
 *
 * Public endpoint the web client polls (every ~60s) to know whether
 * a bonus event is currently active. Returns:
 *   - `null` if nothing is in flight
 *   - `{ id, title, description, longDescription, downloadMultiplier,
 *       uploadMultiplier, startsAt, endsAt }` otherwise
 *
 * The active row is also pushed to Redis on the way out so the Go
 * tracker (which reads `bonus:active` on the announce hot path) and
 * subsequent web hits pay only the cheap cache lookup.
 */
import { db } from '@trackarr/db';
import { bonusEvents } from '@trackarr/db/schema';
import { eq } from 'drizzle-orm';
import { getActiveSnapshot } from '~~/utils/bonusEvents';

export default defineEventHandler(async () => {
  const snap = await getActiveSnapshot();
  if (!snap) return { event: null };

  // The snapshot in Redis is intentionally minimal — perfect for the
  // tracker's needs but missing the descriptions the user-facing
  // popup wants. Pull the full row by id to enrich the response.
  const row = await db.query.bonusEvents.findFirst({
    where: eq(bonusEvents.id, snap.id),
    columns: {
      id: true,
      title: true,
      description: true,
      longDescription: true,
      downloadMultiplier: true,
      uploadMultiplier: true,
      startsAt: true,
      endsAt: true,
    },
  });
  if (!row) return { event: null };

  return {
    event: {
      id: row.id,
      title: row.title,
      description: row.description,
      longDescription: row.longDescription,
      downloadMultiplier: row.downloadMultiplier,
      uploadMultiplier: row.uploadMultiplier,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
    },
  };
});
