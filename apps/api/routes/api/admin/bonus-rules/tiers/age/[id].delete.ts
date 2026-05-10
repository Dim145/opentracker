/** DELETE /api/admin/bonus-rules/tiers/age/:id — drop an age tier. */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });
  await db.delete(schema.bonusAgeTiers).where(eq(schema.bonusAgeTiers.id, id));
  return { success: true };
});
