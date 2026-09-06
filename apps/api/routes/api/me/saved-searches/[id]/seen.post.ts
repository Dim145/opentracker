import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { uuidSchema, validateParam } from '~~/utils/schemas';

/**
 * POST /api/me/saved-searches/:id/seen — « j'ai vu ».
 *
 * Le bandeau d'alertes du catalogue affiche « n nouv. » : les correspondances
 * arrivées depuis la dernière fois que le membre a ouvert cette recherche
 * depuis là. Ouvrir, c'est voir : `seen_count` rejoint `match_count`.
 */
export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const id = validateParam(event, 'id', uuidSchema);

  const rows = await db
    .update(schema.savedSearches)
    .set({ seenCount: sql`${schema.savedSearches.matchCount}` })
    .where(and(eq(schema.savedSearches.id, id), eq(schema.savedSearches.userId, user.id)))
    .returning({ seenCount: schema.savedSearches.seenCount });

  if (rows.length === 0) {
    throw createError({ statusCode: 404, message: 'Saved search not found' });
  }
  return { seenCount: rows[0]!.seenCount };
});
