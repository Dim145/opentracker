/**
 * PATCH /api/torrents/:hash
 * Update torrent description and/or category
 * Owner, moderator, or admin can edit
 */
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { torrents, categories } from '@trackarr/db/schema';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { normalizeMediaId } from '~~/utils/mediaIds';

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

  // Get the torrent
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
  const canEdit = isOwner || user.isAdmin || user.isModerator;

  if (!canEdit) {
    throw createError({
      statusCode: 403,
      message: 'You do not have permission to edit this torrent',
    });
  }

  // Read body
  const body = await readBody(event);
  const { description, categoryId, nfo, imdbId, tmdbId, tvdbId } = body || {};

  // Validate categoryId if provided
  if (categoryId !== undefined && categoryId !== null && categoryId !== '') {
    const categoryExists = await db.query.categories.findFirst({
      where: eq(categories.id, categoryId),
    });

    if (!categoryExists) {
      throw createError({
        statusCode: 400,
        message: 'Invalid category',
      });
    }
  }

  // Same cap as the upload endpoint, applied here so PATCH can't be used
  // to grow the NFO past the documented limit.
  const NFO_MAX_BYTES = 256 * 1024;
  if (
    typeof nfo === 'string' &&
    Buffer.byteLength(nfo, 'utf8') > NFO_MAX_BYTES
  ) {
    throw createError({
      statusCode: 413,
      message: `NFO content exceeds ${NFO_MAX_BYTES} bytes`,
    });
  }

  // Build update object
  const updateData: {
    description?: string | null;
    categoryId?: string | null;
    nfo?: string | null;
    imdbId?: string | null;
    tmdbId?: string | null;
    tvdbId?: string | null;
  } = {};

  if (description !== undefined) {
    updateData.description = description || null;
  }

  if (categoryId !== undefined) {
    updateData.categoryId = categoryId || null;
  }

  if (nfo !== undefined) {
    updateData.nfo = typeof nfo === 'string' && nfo.length > 0 ? nfo : null;
  }

  // Media-database tags. An explicit `null`/empty string clears the
  // field so the user can remove a wrong id; anything else gets
  // normalised (URL → bare id) and stored or rejected silently.
  if (imdbId !== undefined) {
    updateData.imdbId = imdbId ? normalizeMediaId('imdb', imdbId) : null;
  }
  if (tmdbId !== undefined) {
    updateData.tmdbId = tmdbId ? normalizeMediaId('tmdb', tmdbId) : null;
  }
  if (tvdbId !== undefined) {
    updateData.tvdbId = tvdbId ? normalizeMediaId('tvdb', tvdbId) : null;
  }

  // Update the torrent
  if (Object.keys(updateData).length > 0) {
    await db
      .update(torrents)
      .set(updateData)
      .where(eq(torrents.infoHash, infoHash));
  }

  // Fetch updated torrent
  const updated = await db.query.torrents.findFirst({
    where: eq(torrents.infoHash, infoHash),
    with: {
      category: true,
    },
  });

  return {
    success: true,
    message: 'Torrent updated',
    data: {
      infoHash: updated!.infoHash,
      name: updated!.name,
      description: updated!.description,
      nfo: updated!.nfo,
      categoryId: updated!.categoryId,
      category: updated!.category,
      imdbId: updated!.imdbId,
      tmdbId: updated!.tmdbId,
      tvdbId: updated!.tvdbId,
    },
  };
});
