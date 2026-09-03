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

  // Federation: nothing to do here. The record sweep compares published
  // records against live torrents, so a row that is simply gone gets its
  // signed tombstone on the next pass — and a record deliberately outlives the
  // torrent it describes, which is what makes that possible.

  // Delete from Redis cache
  //
  // `completed_once:<torrentId>:*` s'ajoute aux deux : le tracker y pose une
  // clé par (membre, torrent) avec un TTL de SIX MOIS, pour qu'un `completed`
  // rejoué ne gonfle pas le compteur public. Une ligne supprimée laissait donc
  // ces marques une demi-année, et un infohash réenvoyé après suppression —
  // ce que la branche « déjà existant » du point d'envoi permet — héritait des
  // complétions de l'ancienne ligne, donc d'un compteur qui refusait de
  // repartir à zéro.
  //
  // `SCAN` plutôt que `KEYS` : le motif est étroit (un torrent, ses membres)
  // mais `KEYS` bloque Redis le temps du parcours de l'espace ENTIER.
  try {
    await redis.del(`peers:${infoHash}`);
    await redis.del(`stats:${infoHash}`);
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        `${redis.options.keyPrefix ?? ''}completed_once:${existing.id}:*`,
        'COUNT',
        200
      );
      cursor = next;
      if (keys.length > 0) {
        // `scan` rend des clés PRÉFIXÉES, et `del` en rajoute un : on retire
        // le préfixe avant de supprimer.
        const prefix = redis.options.keyPrefix ?? '';
        await redis.del(...keys.map((k) => (prefix && k.startsWith(prefix) ? k.slice(prefix.length) : k)));
      }
    } while (cursor !== '0');
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
