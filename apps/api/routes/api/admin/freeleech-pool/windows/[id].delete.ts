/**
 * DELETE /api/admin/freeleech-pool/windows/:id — remove a window.
 *
 * Idempotent: deleting a non-existent row returns success with
 * `removed: false`. The pool happens-to-be-open check on the next
 * contribution will recompute against the new table state.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing id' });
  }
  const deleted = await db
    .delete(schema.freeleechPoolWindows)
    .where(eq(schema.freeleechPoolWindows.id, id))
    .returning({ id: schema.freeleechPoolWindows.id });
  return { removed: deleted.length > 0 };
});
