/**
 * DELETE /api/mod/warnings/:id — révoquer un avertissement.
 *
 * Révoquer, pas supprimer : la ligne survit avec `revoked_at` et l'auteur de
 * la révocation. Un registre dont on peut retirer des pages n'est pas un
 * registre — et un modérateur qui se trompe doit pouvoir le dire sans effacer
 * la trace de son erreur.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, isNull } from 'drizzle-orm';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Warning id is required' });
  }

  const rows = await db
    .update(schema.userWarnings)
    .set({ revokedAt: new Date(), revokedById: user.id })
    .where(
      and(eq(schema.userWarnings.id, id), isNull(schema.userWarnings.revokedAt))
    )
    .returning({ id: schema.userWarnings.id });

  if (rows.length === 0) {
    throw createError({
      statusCode: 404,
      message: 'Warning not found, or already revoked',
    });
  }
  return { ok: true };
});
