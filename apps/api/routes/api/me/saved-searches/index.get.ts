/**
 * GET /api/me/saved-searches — the member's stored filters.
 */
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { getSavedSearchMaxPerUser } from '~~/utils/settings';

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const [items, max] = await Promise.all([
    db.query.savedSearches.findMany({
      where: eq(schema.savedSearches.userId, user.id),
      with: { category: { columns: { id: true, name: true, slug: true } } },
      orderBy: [desc(schema.savedSearches.createdAt)],
    }),
    getSavedSearchMaxPerUser(),
  ]);

  return { items, max };
});
