import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validateParam, infoHashSchema } from '~~/utils/schemas';
import { resolveTagsByName, MAX_TAGS_PER_TORRENT } from '~~/utils/tags';

// Accept either pre-resolved `tagIds` (kept for the existing admin UI)
// or free-form `tags` strings (the user-facing flow from issue #45).
// At least one of the two must be present.
const updateTagsSchema = z
  .object({
    tagIds: z.array(z.string()).max(MAX_TAGS_PER_TORRENT).optional(),
    tags: z.array(z.string()).max(MAX_TAGS_PER_TORRENT).optional(),
  })
  .refine((v) => v.tagIds !== undefined || v.tags !== undefined, {
    message: 'Provide either tagIds or tags',
  });

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);

  const infoHash = validateParam(event, 'hash', infoHashSchema);

  // Get torrent
  const torrent = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, infoHash),
    columns: { id: true, uploaderId: true },
  });

  if (!torrent) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  // Only uploader or admin/mod can update tags
  if (torrent.uploaderId !== user.id && !user.isAdmin && !user.isModerator) {
    throw createError({ statusCode: 403, message: 'Not authorized' });
  }

  const body = await readBody(event);
  const parsed = updateTagsSchema.parse(body);

  // Resolve names → ids first so we can fail before mutating anything.
  const resolvedIds = parsed.tags
    ? (await resolveTagsByName(parsed.tags)).ids
    : [];
  // Final id list: dedupe across both inputs.
  const ids = Array.from(new Set([...(parsed.tagIds ?? []), ...resolvedIds]));
  if (ids.length > MAX_TAGS_PER_TORRENT) {
    throw createError({
      statusCode: 400,
      message: `Too many tags (max ${MAX_TAGS_PER_TORRENT})`,
    });
  }

  // Delete existing tags
  await db
    .delete(schema.torrentTags)
    .where(eq(schema.torrentTags.torrentId, torrent.id));

  // Insert new tags
  if (ids.length > 0) {
    await db.insert(schema.torrentTags).values(
      ids.map((tagId) => ({
        torrentId: torrent.id,
        tagId,
      }))
    );
  }

  // Fetch updated tags
  const updatedTags = await db.query.torrentTags.findMany({
    where: eq(schema.torrentTags.torrentId, torrent.id),
    with: { tag: true },
  });

  return {
    success: true,
    tags: updatedTags.map((tt) => tt.tag),
  };
});
