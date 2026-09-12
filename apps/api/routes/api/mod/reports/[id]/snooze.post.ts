/**
 * POST /api/mod/reports/:id/snooze — mettre un signalement de côté.
 *
 * Même raison que pour les envois : un signalement qui attend la réponse du
 * signalant ou d'un tiers ne doit pas encombrer la file de ceux sur lesquels
 * on peut avancer. `{ "duration": null }` le réveille.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';

const DURATIONS = {
  '1d': 24 * 60 * 60 * 1000,
  '3d': 3 * 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
} as const;

const bodySchema = z.object({
  duration: z.enum(['1d', '3d', '7d']).nullable(),
});

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Report id is required' });
  }
  const body = await validateBody(event, bodySchema);

  const until = body.duration
    ? new Date(Date.now() + DURATIONS[body.duration])
    : null;

  const rows = await db
    .update(schema.reports)
    .set({ snoozedUntil: until })
    .where(eq(schema.reports.id, id))
    .returning({ id: schema.reports.id });

  if (rows.length === 0) {
    throw createError({ statusCode: 404, message: 'Report not found' });
  }
  return { ok: true, snoozedUntil: until };
});
