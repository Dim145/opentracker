/**
 * DELETE /api/mod/torrents/:hash/snooze — réveiller un envoi mis de côté.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const hash = getRouterParam(event, 'hash')?.toLowerCase();
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }

  const rows = await db
    .update(schema.torrents)
    .set({ moderationSnoozedUntil: null })
    .where(eq(schema.torrents.infoHash, hash))
    .returning({ id: schema.torrents.id });

  if (rows.length === 0) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }
  return { ok: true };
});
