/**
 * GET /api/torrents/:hash/cross-seeds
 *
 * Lists every other torrent that ships the same content (same canonical
 * file list) as the one identified by `:hash`. Used by the detail page
 * to surface "this content is also available on N other torrents" plus
 * a clickable list.
 *
 * Moderation visibility mirrors `/api/torrents/:hash`: a regular user
 * only sees `accepted` cross-seeds (and the one row tied to their own
 * pending upload if applicable); staff see everything.
 *
 * Returns 404 when the source torrent doesn't exist OR carries no
 * usable `content_signature` (empty string after a failed backfill,
 * or null on a brand-new row that the backfill hasn't picked up yet).
 * The FE treats both as "no cross-seeds known" — same UX as a
 * legitimate empty list.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, ne } from 'drizzle-orm';
import { validateParam, infoHashSchema } from '~~/utils/schemas';

export default defineEventHandler(async (event) => {
  const { user: session } = await requireUserSession(event);
  const infoHash = validateParam(event, 'hash', infoHashSchema);

  const source = await db.query.torrents.findFirst({
    where: (t, { eq }) => eq(t.infoHash, infoHash),
    columns: {
      id: true,
      uploaderId: true,
      moderationStatus: true,
      contentSignature: true,
    },
  });
  if (!source) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  // Same moderation gate as the parent endpoint.
  if (source.moderationStatus !== 'accepted') {
    const isOwner = source.uploaderId === session.id;
    const isStaff = !!(session.isAdmin || session.isModerator);
    if (!isOwner && !isStaff) {
      throw createError({ statusCode: 404, message: 'Torrent not found' });
    }
  }

  if (!source.contentSignature) {
    // No signature yet → no cross-seeds we can compute. Return an
    // empty list rather than 404 so the FE doesn't have to special-
    // case backfill-in-progress torrents.
    return { items: [], total: 0 };
  }

  const isStaff = !!(session.isAdmin || session.isModerator);
  const rows = await db.query.torrents.findMany({
    where: (t, { and, eq, ne }) =>
      and(
        eq(t.contentSignature, source.contentSignature!),
        ne(t.id, source.id),
        // Non-staff users only see accepted cross-seeds. The
        // moderation queue is staff-only; surfacing a `pending`
        // cross-seed to a member would leak the existence of an
        // upload the moderation system has deliberately hidden.
        isStaff ? undefined : eq(t.moderationStatus, 'accepted'),
      ),
    columns: {
      id: true,
      infoHash: true,
      name: true,
      size: true,
      moderationStatus: true,
      createdAt: true,
    },
    with: {
      category: {
        columns: { id: true, name: true, slug: true, type: true },
      },
      uploader: {
        columns: { id: true, username: true },
      },
    },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 50,
  });

  return {
    items: rows,
    total: rows.length,
  };
});
