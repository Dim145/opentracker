import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { reevaluateUserRole } from '~~/utils/roleRules';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);

  const hash = getRouterParam(event, 'hash');
  const body = await readBody(event);

  if (!hash) {
    throw createError({
      statusCode: 400,
      message: 'Torrent hash is required',
    });
  }

  // Find and delete the torrent
  const [deletedTorrent] = await db
    .delete(schema.torrents)
    .where(eq(schema.torrents.infoHash, hash.toLowerCase()))
    .returning();

  if (!deletedTorrent) {
    throw createError({
      statusCode: 404,
      message: 'Torrent not found',
    });
  }

  // Also delete associated stats
  await db
    .delete(schema.torrentStats)
    .where(eq(schema.torrentStats.infoHash, hash.toLowerCase()));

  // Rejecting a torrent removes it from the uploader's totalUploads
  // count, which can knock them below the threshold of an auto role.
  // Same fire-and-forget pattern as the approve hook.
  if (deletedTorrent.uploaderId) {
    void reevaluateUserRole(deletedTorrent.uploaderId).catch((err) => {
      console.error('[Roles] post-reject sweep failed:', err);
    });
  }

  return {
    success: true,
    message: 'Torrent rejected and deleted',
    reason: body?.reason || 'No reason provided',
  };
});
