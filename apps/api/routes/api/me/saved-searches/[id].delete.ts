/**
 * DELETE /api/me/saved-searches/:id — own rows only.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { uuidSchema, validateParam } from '~~/utils/schemas';

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const id = validateParam(event, 'id', uuidSchema);

  // Scoped to the owner in the WHERE rather than checked first: one statement,
  // and no window between the check and the delete.
  const deleted = await db
    .delete(schema.savedSearches)
    .where(
      and(eq(schema.savedSearches.id, id), eq(schema.savedSearches.userId, user.id))
    )
    .returning({ id: schema.savedSearches.id });

  if (deleted.length === 0) {
    throw createError({ statusCode: 404, message: 'Saved search not found' });
  }
  return { success: true };
});
