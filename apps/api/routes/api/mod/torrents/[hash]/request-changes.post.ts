/**
 * POST /api/mod/torrents/:hash/request-changes
 *
 * Move a torrent to `changes_requested`. The uploader sees the
 * moderator's note on the torrent page, edits the row, and any save
 * automatically reverts the status to `pending` so the moderator
 * can re-review. Body is required (the user has to know what to
 * change).
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { validateBody } from '~~/utils/schemas';
import { transitionStatus } from '~~/utils/torrentModeration';
import { notify } from '~~/utils/notify';

const bodySchema = z.object({
  message: z.string().trim().min(1, 'A note explaining what to change is required').max(4000),
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
    columns: { id: true, moderationStatus: true },
  });
  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  const updated = await transitionStatus({
    torrentId: torrent.id,
    nextStatus: 'changes_requested',
    actorId: session.user.id,
    body: body.message,
  });

  if (updated.uploaderId) {
    void notify(
      updated.uploaderId,
      'upload_changes_requested',
      {
        torrentName: updated.name,
        moderatorUsername: session.user.username,
        message: body.message,
      },
      `/torrents/${hash.toLowerCase()}/edit`,
    );
  }

  return { success: true, torrent: updated };
});
