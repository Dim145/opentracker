/**
 * POST /api/mod/torrents/:hash/reject
 *
 * Mark a torrent as `rejected` and keep the row. Re-uploading the
 * same info_hash is then blocked at /api/torrents (POST) — that's
 * the whole point of keeping the row instead of deleting it.
 *
 * The note body is required: the uploader needs to understand why so
 * they don't keep retrying. Only a moderator can move the row away
 * from `rejected` afterwards (via /reset).
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { reevaluateUserRole } from '~~/utils/roleRules';
import { validateBody } from '~~/utils/schemas';
import { transitionStatus } from '~~/utils/torrentModeration';

const bodySchema = z.object({
  message: z.string().trim().min(1, 'A reason is required').max(4000),
});

export default defineEventHandler(async (event) => {
  const session = await requireModeratorSession(event);
  const hash = getRouterParam(event, 'hash');
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }
  const body = await validateBody(event, bodySchema);

  const torrent = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, hash.toLowerCase()),
    columns: { id: true, uploaderId: true, moderationStatus: true },
  });
  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  const updated = await transitionStatus({
    torrentId: torrent.id,
    nextStatus: 'rejected',
    actorId: session.user.id,
    body: body.message,
  });

  // If the row had previously been accepted (rare — staff downgrading
  // a published row), the uploader's `approvedUploads` just dropped.
  // Refresh the auto-role sweep so any role gated on that count
  // reflects the new reality.
  if (updated.uploaderId) {
    void reevaluateUserRole(updated.uploaderId).catch((err) => {
      console.error('[Roles] post-reject sweep failed:', err);
    });
  }

  return { success: true, torrent: updated };
});
