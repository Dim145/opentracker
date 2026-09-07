import { desc } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateQuery } from '~~/utils/schemas';

/**
 * GET /api/admin/search-misses — ce que les membres cherchent en vain.
 *
 * Les plus fréquentes d'abord, puis les plus récentes : c'est une liste
 * d'acquisition, et le haut de la liste est ce qui manque le plus.
 */
const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const { limit } = validateQuery(event, querySchema);
  const items = await db
    .select()
    .from(schema.searchMisses)
    .orderBy(desc(schema.searchMisses.count), desc(schema.searchMisses.lastAt))
    .limit(limit);
  return { items };
});
