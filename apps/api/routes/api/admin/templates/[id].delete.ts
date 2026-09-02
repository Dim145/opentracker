/**
 * DELETE /api/admin/templates/:id
 *
 * Remove a template from the site catalogue.
 *
 * What this does NOT touch: copies members already duplicated (their own rows,
 * with their own ids) and listings already posted (rendered BBCode, not a
 * reference). Removing a catalogue entry only stops it being offered.
 *
 * Same `visibility = 'site'` predicate as the edit route, for the same reason:
 * an admin endpoint must not become a way to delete a member's private draft.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateRouterParams } from '~~/utils/schemas';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.admin);
  const { id } = validateRouterParams(event, paramsSchema);

  const [deleted] = await db
    .delete(schema.presentationTemplates)
    .where(
      and(
        eq(schema.presentationTemplates.id, id),
        eq(schema.presentationTemplates.visibility, 'site'),
      ),
    )
    .returning({ id: schema.presentationTemplates.id });

  if (!deleted) {
    throw createError({ statusCode: 404, message: 'Site template not found' });
  }

  return { success: true };
});
