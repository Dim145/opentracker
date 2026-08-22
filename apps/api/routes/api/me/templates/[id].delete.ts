/**
 * DELETE /api/me/templates/:id
 *
 * The owner deletes their own; staff can also take down one that is
 * PUBLISHED. Without that second path a template the whole site reads had
 * no removal route at all — if its author went inactive the operator was
 * stuck with it, since publishing and unpublishing both require a staff
 * role the author may no longer have.
 *
 * A hard delete: a template is authored text with no
 * downstream references — listings already carry the rendered BBCode, so
 * removing the template it came from changes nothing that shipped.
 *
 * Deleting the caller's default leaves them with no default rather than
 * promoting a survivor. The fiche wizard falls back to the built-in
 * default template, which is the same thing a new account sees, and
 * silently promoting an arbitrary row would change what the next upload
 * looks like without anybody asking for it.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { readLiveRoles } from '~~/utils/adminAuth';
import { canWriteTemplate } from '~~/utils/templatePolicy';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));

  // A read is needed before the delete now that staff have a takedown
  // path: authorisation depends on the row's visibility, which a single
  // DELETE predicate cannot express without also deleting other people's
  // private drafts. The read-then-write window is harmless here — a
  // concurrent delete just makes the second one report 404.
  const row = await db.query.presentationTemplates.findFirst({
    where: eq(schema.presentationTemplates.id, id),
    columns: { id: true, ownerId: true, visibility: true },
  });
  if (!row) {
    throw createError({ statusCode: 404, message: 'Template not found' });
  }

  // Only pay for the live-role read when the row is published — the case
  // where a non-owner may legitimately be allowed through.
  let isStaff = false;
  if (row.visibility === 'published') {
    const live = await readLiveRoles(user.id);
    isStaff = !!live && (live.isAdmin || live.isModerator);
  }
  if (!canWriteTemplate(row, { id: user.id, isStaff })) {
    // A private template that is not yours reports 404 rather than 403:
    // its existence is not public, and saying "forbidden" would confirm
    // the id. A published one is already public, so 403 is honest.
    throw createError(
      row.visibility === 'published'
        ? {
            statusCode: 403,
            message: 'Only staff can remove a template published to the whole site',
          }
        : { statusCode: 404, message: 'Template not found' },
    );
  }

  const [deleted] = await db
    .delete(schema.presentationTemplates)
    .where(eq(schema.presentationTemplates.id, id))
    .returning({ id: schema.presentationTemplates.id });

  if (!deleted) {
    throw createError({ statusCode: 404, message: 'Template not found' });
  }

  return { success: true };
});
