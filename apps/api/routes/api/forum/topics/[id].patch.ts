/**
 * PATCH /api/forum/topics/:id — renommer un sujet, ou le déplacer de section.
 *
 * Ces deux gestes n'existaient POUR PERSONNE. Le titre et la section étaient
 * écrits une seule fois, par l'INSERT de `topics/index.post.ts:22`, et aucune
 * route ne les touchait ensuite : `topics/[id]` ne portait que `delete`,
 * `lock` et `pin`.
 *
 * Conséquence : un sujet mal titré restait mal titré, et un sujet posté dans
 * la mauvaise section y restait — ou bien il fallait le supprimer et demander
 * à son auteur de le reposter, ce qui détruit les réponses déjà écrites.
 * L'administration ne pouvait pas davantage : ce n'était pas une permission
 * retenue, c'était un outil manquant.
 *
 * Les deux sont ici, gardés modérateur — c'est du rangement, pas une décision
 * d'autorité. L'auteur du sujet, lui, ne peut pas s'en servir : laisser
 * quelqu'un déplacer son propre fil vers une section plus visible en ferait
 * un levier de mise en avant.
 */
import { db } from '@trackarr/db';
import { forumCategories, forumTopics } from '@trackarr/db/schema';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const bodySchema = z
  .object({
    // Même plancher que la création : un titre d'un caractère n'aide personne
    // à retrouver un fil.
    title: z.string().trim().min(3).max(200).optional(),
    categoryId: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (b) => b.title !== undefined || b.categoryId !== undefined,
    'Nothing to change'
  );

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Topic ID is required' });
  }
  const body = await validateBody(event, bodySchema);

  // Une section inconnue produirait une clé étrangère orpheline et un sujet
  // invisible. On vérifie avant d'écrire plutôt que de traduire une erreur de
  // contrainte en 500.
  if (body.categoryId) {
    const target = await db.query.forumCategories.findFirst({
      where: eq(forumCategories.id, body.categoryId),
      columns: { id: true },
    });
    if (!target) {
      throw createError({ statusCode: 404, message: 'Section not found' });
    }
  }

  const updated = await db
    .update(forumTopics)
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
    })
    .where(eq(forumTopics.id, id))
    .returning();

  if (updated.length === 0) {
    throw createError({ statusCode: 404, message: 'Topic not found' });
  }
  return updated[0];
});
