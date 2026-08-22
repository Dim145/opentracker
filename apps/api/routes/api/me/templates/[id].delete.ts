/**
 * DELETE /api/me/templates/:id
 *
 * Owner-only. A site template is not deletable here whoever is asking —
 * removing one is an admin act on the admin screen, not something that can
 * happen through a member endpoint.
 *
 * A hard delete: a template is authored text with no downstream references —
 * listings already carry the rendered BBCode, so removing the template it came
 * from changes nothing that shipped.
 *
 * Deleting the caller's default leaves them with no default rather than
 * promoting a survivor. The fiche wizard falls back to the built-in
 * default template, which is the same thing a new account sees, and
 * silently promoting an arbitrary row would change what the next upload
 * looks like without anybody asking for it.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));

  // One statement, scoped to the owner: a row that is not the caller's and a
  // row that does not exist both come back as zero rows, so neither the
  // existence of somebody else's private draft nor of a site template can be
  // probed from here.
  const [deleted] = await db
    .delete(schema.presentationTemplates)
    .where(
      and(
        eq(schema.presentationTemplates.id, id),
        eq(schema.presentationTemplates.ownerId, user.id),
      ),
    )
    .returning({ id: schema.presentationTemplates.id });

  if (!deleted) {
    throw createError({ statusCode: 404, message: 'Template not found' });
  }

  return { success: true };
});
