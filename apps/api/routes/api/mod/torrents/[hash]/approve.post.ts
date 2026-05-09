import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { reevaluateUserRole } from '~~/utils/roleRules';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);

  const hash = getRouterParam(event, 'hash');

  if (!hash) {
    throw createError({
      statusCode: 400,
      message: 'Torrent hash is required',
    });
  }

  // Approve the torrent
  const [approvedTorrent] = await db
    .update(schema.torrents)
    .set({ isApproved: true })
    .where(eq(schema.torrents.infoHash, hash.toLowerCase()))
    .returning();

  if (!approvedTorrent) {
    throw createError({
      statusCode: 404,
      message: 'Torrent not found',
    });
  }

  // The uploader's `approvedUploads` count just went up — that's the
  // headline trigger for auto roles like "Certified". Fire-and-forget
  // so the moderator's response time isn't tied to the sweep.
  if (approvedTorrent.uploaderId) {
    void reevaluateUserRole(approvedTorrent.uploaderId).catch((err) => {
      console.error('[Roles] post-approve sweep failed:', err);
    });
  }

  return {
    success: true,
    message: 'Torrent approved',
    torrent: approvedTorrent,
  };
});
