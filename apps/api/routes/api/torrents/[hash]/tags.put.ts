import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { validateParam, infoHashSchema, validateBody } from '~~/utils/schemas';
import { resolveTagsByName, MAX_TAGS_PER_TORRENT } from '~~/utils/tags';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

// Accept either pre-resolved `tagIds` (kept for the existing admin UI)
// or free-form `tags` strings (the user-facing flow from issue #45).
// At least one of the two must be present.
const updateTagsSchema = z
  .object({
    // `z.string()` acceptait n'importe quoi et l'envoyait dans une colonne
    // porteuse d'une clé étrangère : l'échec arrivait en 500 côté Postgres, pas
    // en 400 côté schéma.
    tagIds: z.array(z.string().uuid()).max(MAX_TAGS_PER_TORRENT).optional(),
    tags: z.array(z.string()).max(MAX_TAGS_PER_TORRENT).optional(),
  })
  .refine((v) => v.tagIds !== undefined || v.tags !== undefined, {
    message: 'Provide either tagIds or tags',
  });

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);

  // `resolveTagsByName` CRÉE les étiquettes absentes : sans limite, 600
  // requêtes par minute et par IP injectent jusqu'à 6 000 lignes `tags` dans un
  // catalogue administré à la main, sans laisser de trace.
  await rateLimit(event, RATE_LIMITS.mutation);

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

  const parsed = await validateBody(event, updateTagsSchema);

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

  // Le remplacement, dans UNE transaction.
  //
  // C'étaient deux écritures séparées, la première destructrice.
  // `torrentTags.tagId` porte une clé étrangère vers `tags.id`, et le schéma
  // n'exigeait que « tableau de chaînes » : un identifiant inexistant faisait
  // donc échouer l'INSERT sur violation de clé étrangère APRÈS que le DELETE
  // avait été validé. Un `PUT {"tagIds":["x"]}` répondait 500 et emportait
  // TOUTES les étiquettes du torrent.
  //
  // La validation en `uuid()` ci-dessus ne suffit pas seule — un UUID bien
  // formé mais absent échoue de la même façon : c'est la transaction qui rend
  // l'échec inoffensif.
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.torrentTags)
      .where(eq(schema.torrentTags.torrentId, torrent.id));
    if (ids.length > 0) {
      await tx.insert(schema.torrentTags).values(
        ids.map((tagId) => ({
          torrentId: torrent.id,
          tagId,
        }))
      );
    }
  });

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
