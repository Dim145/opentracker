/** DELETE /api/admin/bonus-rules/tiers/seed-count/:id — drop a tier. */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });
  await db
    .delete(schema.bonusSeedCountTiers)
    .where(eq(schema.bonusSeedCountTiers.id, id));
  return { success: true };
});
