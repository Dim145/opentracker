/**
 * PATCH /api/torrents/comments/:id — corriger un commentaire.
 *
 * Il n'y avait que `delete`. Un commentaire long et utile dont une seule ligne
 * pose problème ne laissait qu'un choix : tout supprimer. Le membre perdait
 * son travail, et les réponses qui s'y rattachaient perdaient leur contexte.
 *
 * Deux règles, et la seconde est la plus importante :
 *
 *   · l'auteur peut se corriger, comme partout ailleurs ;
 *   · le personnel peut retirer ce qui doit l'être — mais la ligne GARDE la
 *     trace de qui l'a réécrite (`editedById`), et l'interface la montre.
 *
 * Sans cette marque, la fonction serait pire que son absence : réécrire les
 * mots de quelqu'un en silence, c'est lui faire dire ce qu'il n'a pas dit.
 * `updatedAt` ne suffit pas — il bouge aussi quand l'auteur se relit.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { notify } from '~~/utils/notify';

const bodySchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Comment id is required' });
  }
  const body = await validateBody(event, bodySchema);

  const comment = await db.query.torrentComments.findFirst({
    where: eq(schema.torrentComments.id, id),
    columns: { id: true, authorId: true, content: true },
    with: { torrent: { columns: { infoHash: true } } },
  });
  if (!comment) {
    throw createError({ statusCode: 404, message: 'Comment not found' });
  }

  const isAuthor = comment.authorId === session.user.id;
  const isStaff = !!(session.user.isAdmin || session.user.isModerator);
  if (!isAuthor && !isStaff) {
    throw createError({
      statusCode: 403,
      message: 'You can only edit your own comment',
    });
  }

  await db
    .update(schema.torrentComments)
    .set({
      content: body.content,
      updatedAt: new Date(),
      // L'auteur qui se corrige n'est pas une intervention : on ne marque que
      // la main du personnel sur le texte d'autrui.
      ...(isAuthor
        ? {}
        : { editedById: session.user.id, editedAt: new Date() }),
    })
    .where(eq(schema.torrentComments.id, id));

  // Le membre doit apprendre qu'on a touché à ses mots, et par qui. Le
  // découvrir par hasard est la pire façon.
  if (!isAuthor && comment.authorId) {
    await notify(
      comment.authorId,
      'moderation_comment_edited',
      { moderatorUsername: session.user.username },
      comment.torrent ? `/torrents/${comment.torrent.infoHash}#comment-${id}` : null
    ).catch(() => {
      // La notification est un plus ; la trace en base est la garantie.
    });
  }

  return { ok: true };
});
