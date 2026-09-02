/**
 * PATCH /api/torrents/:hash
 *
 * Update an existing torrent's metadata (name, description, category,
 * NFO, media ids). Permission: the uploader, a moderator, or an
 * admin.
 *
 * Moderation interaction:
 *   - `rejected` rows are frozen for everyone (the row is kept as a
 *     paper trail; staff have to call /api/mod/torrents/:hash/reset
 *     before they can touch the metadata again).
 *   - When a non-bypass user (= regular member without the role flag)
 *     edits an `accepted` or `changes_requested` row, the status
 *     auto-reverts to `pending` and a system message is posted to the
 *     moderation thread so the queue surfaces it again.
 *   - Staff or bypass-flagged members keep the current status when
 *     they edit — they're trusted to publish without re-review.
 */
import { eq } from 'drizzle-orm';
import { validateBody } from '~~/utils/schemas';
import { z } from 'zod';
import { db } from '@trackarr/db';
import { torrents, categories, torrentModerationMessages } from '@trackarr/db/schema';
import { randomUUID } from 'node:crypto';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { normalizeMediaId } from '~~/utils/mediaIds';
import { userCanBypassModeration } from '~~/utils/torrentModeration';

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
  const isStaff = !!(user.isAdmin || user.isModerator);
  const canEdit = isOwner || isStaff;

  if (!canEdit) {
    throw createError({
      statusCode: 403,
      message: 'You do not have permission to edit this torrent',
    });
  }

  // Rejected rows are frozen until a moderator resets them. The
  // dedicated /api/mod/torrents/:hash/reset endpoint handles that
  // explicitly so the metadata can never be silently rewritten while
  // the row is in the rejected state — even by staff.
  if (existing.moderationStatus === 'rejected') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message:
        'This torrent is rejected. A moderator must reset its status before it can be edited.',
    });
  }

  // Whether this editor publishes without going through review.
  // Staff always do; regular members only if a role grants the
  // bypass flag. The result drives the auto-revert on save below.
  const canBypass = isStaff || (await userCanBypassModeration(user));

  /*
   * Un schéma, pas `readBody()` nu.
   *
   * C'était l'une des cinq routes mutantes sans validation : `categoryId`
   * partait tel quel dans `eq(categories.id, categoryId)`, donc un objet ou un
   * nombre produisait une 500 de Postgres au lieu d'une 400 — pas d'injection
   * (Drizzle paramètre), mais un plantage là où il fallait un refus. Même forme
   * pour `description`, dont un objet atterrissait dans une colonne `text`.
   *
   * Les bornes reprennent celles que la route appliquait déjà à la main plus
   * bas, et celles du point d'envoi : c'est le même contrat, exprimé une fois
   * en entrée plutôt que dispersé dans le corps du handler.
   */
  const patchSchema = z
    .object({
      name: z.string().min(1).max(256).optional(),
      description: z.string().max(10_000).nullish(),
      categoryId: z.string().uuid().nullish().or(z.literal('')),
      nfo: z.string().max(256 * 1024).nullish(),
      imdbId: z.string().max(32).nullish(),
      tmdbId: z.string().max(32).nullish(),
      tvdbId: z.string().max(32).nullish(),
      igdbId: z.string().max(32).nullish(),
      openlibraryId: z.string().max(64).nullish(),
    })
    .strict();

  const body = await validateBody(event, patchSchema);
  const {
    name,
    description,
    categoryId,
    nfo,
    imdbId,
    tmdbId,
    tvdbId,
    igdbId,
    openlibraryId,
  } = body || {};

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
    name?: string;
    description?: string | null;
    categoryId?: string | null;
    nfo?: string | null;
    imdbId?: string | null;
    tmdbId?: string | null;
    tvdbId?: string | null;
    igdbId?: string | null;
    openlibraryId?: string | null;
  } = {};

  // Allow renaming the release. We require non-empty when provided so a
  // bad client can't blank the column out (the schema marks it
  // notNull). 256 chars matches typical scene name lengths.
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      throw createError({
        statusCode: 400,
        message: 'Release name cannot be empty',
      });
    }
    updateData.name = name.trim().slice(0, 256);
  }

  if (description !== undefined) {
    // Same 10k cap as upload — PATCH must not be a back door to an
    // unbounded description column (finding L2).
    if (typeof description === 'string' && description.length > 10_000) {
      throw createError({
        statusCode: 413,
        message: 'Description exceeds 10000 characters',
      });
    }
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
  // IGDB normalisation goes through the metadata façade because the
  // slug→id resolve is asynchronous. Null/empty clears the column;
  // a network failure during resolve falls back to null rather than
  // blocking the edit.
  if (igdbId !== undefined) {
    if (!igdbId) {
      updateData.igdbId = null;
    } else {
      try {
        const { normalizeSourceId, isSourceEnabled } = await import(
          '~~/utils/metadata'
        );
        updateData.igdbId = isSourceEnabled('igdb')
          ? await normalizeSourceId('igdb', igdbId)
          : null;
      } catch (err) {
        console.warn(
          '[torrents] IGDB normalize failed:',
          (err as Error).message
        );
        updateData.igdbId = null;
      }
    }
  }
  // Open Library never gates on env vars (no auth) — empty input
  // still clears the column; normalisation rejects garbage by
  // returning null, same as the upload route.
  if (openlibraryId !== undefined) {
    if (!openlibraryId) {
      updateData.openlibraryId = null;
    } else {
      try {
        const { normalizeSourceId } = await import('~~/utils/metadata');
        updateData.openlibraryId = await normalizeSourceId(
          'openlibrary',
          openlibraryId
        );
      } catch (err) {
        console.warn(
          '[torrents] Open Library normalize failed:',
          (err as Error).message
        );
        updateData.openlibraryId = null;
      }
    }
  }

  // Decide whether the edit triggers an auto-revert to pending.
  // Only fires for non-bypass editors changing an `accepted` or
  // `changes_requested` row. Edits on `pending` rows stay pending.
  const shouldRevertToPending =
    !canBypass &&
    (existing.moderationStatus === 'accepted' ||
      existing.moderationStatus === 'changes_requested');

  if (shouldRevertToPending) {
    (updateData as Record<string, unknown>).moderationStatus = 'pending';
    (updateData as Record<string, unknown>).moderatedById = user.id;
    (updateData as Record<string, unknown>).moderatedAt = new Date();
  }

  // Update the torrent
  if (Object.keys(updateData).length > 0) {
    await db
      .update(torrents)
      .set(updateData)
      .where(eq(torrents.infoHash, infoHash));
  }

  if (shouldRevertToPending) {
    // System message in the moderation thread so the queue and the
    // discussion timeline both reflect what just happened. The
    // body picks the right copy depending on whether the row was
    // already in changes_requested (a true resubmission) or just a
    // plain edit on an accepted row.
    const wasChangesRequested =
      existing.moderationStatus === 'changes_requested';
    await db.insert(torrentModerationMessages).values({
      id: randomUUID(),
      torrentId: existing.id,
      authorId: user.id,
      body: wasChangesRequested
        ? 'Resubmitted for review after edits.'
        : 'Edits made; returning to the moderation queue.',
      isSystem: true,
      statusChange: 'pending',
      createdAt: new Date(),
    });

    // Federation: nothing to do here either. Leaving 'accepted' takes the row
    // out of the publishable predicate, and the sweep tombstones it from that
    // fact alone.
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
    message: shouldRevertToPending
      ? 'Torrent updated. Sent back to moderation for review.'
      : 'Torrent updated',
    revertedToPending: shouldRevertToPending,
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
      moderationStatus: updated!.moderationStatus,
    },
  };
});
