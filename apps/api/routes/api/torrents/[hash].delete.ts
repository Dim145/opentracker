/**
 * DELETE /api/torrents/:hash
 * Delete a torrent from the tracker
 * Owner, moderator, or admin can delete
 */
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { torrents } from '@trackarr/db/schema';
import { redis } from '~~/utils/server';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { notify } from '~~/utils/notify';

export default defineEventHandler(async (event) => {
  // Rate limit mutations
  await rateLimit(event, RATE_LIMITS.mutation);

  // Require authentication
  const { user } = await requireAuthSession(event);

  const hash = getRouterParam(event, 'hash');

  if (!hash) {
    throw createError({
      statusCode: 400,
      message: 'Missing info hash',
    });
  }

  const infoHash = hash.toLowerCase();

  // Check if torrent exists
  const existing = await db.query.torrents.findFirst({
    where: eq(torrents.infoHash, infoHash),
  });

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: 'Torrent not found',
    });
  }

  // Check permissions: owner, moderator, or admin
  const isOwner = existing.uploaderId === user.id;
  const canDelete = isOwner || user.isAdmin || user.isModerator;

  if (!canDelete) {
    throw createError({
      statusCode: 403,
      message: 'You do not have permission to delete this torrent',
    });
  }

  // Delete from PostgreSQL
  await db.delete(torrents).where(eq(torrents.infoHash, infoHash));

  // Delete from Redis cache
  try {
    await redis.del(`peers:${infoHash}`);
    await redis.del(`stats:${infoHash}`);
  } catch {
    // Redis errors are non-fatal
  }

  // Notify the uploader when staff deleted someone else's torrent.
  // A user deleting their own row is a deliberate self-action — no
  // notification needed for that case.
  const deletedByStaff = !isOwner && (user.isAdmin || user.isModerator);
  if (deletedByStaff && existing.uploaderId) {
    void notify(
      existing.uploaderId,
      'torrent_deleted_by_staff',
      {
        torrentName: existing.name,
        actorUsername: user.username,
      },
      null,
    );
  }

  return {
    success: true,
    message: 'Torrent deleted',
    data: {
      infoHash,
      name: existing.name,
    },
  };
});
