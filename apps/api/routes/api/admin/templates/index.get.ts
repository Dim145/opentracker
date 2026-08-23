/**
 * GET /api/admin/templates
 *
 * The site template catalogue, as the admin screen sees it: every row an
 * admin has put in front of the whole membership, newest first, with the
 * name of whoever added it.
 *
 * Members read the same rows through `GET /api/me/templates?scope=site`,
 * which returns them alongside the member's own and without `createdBy`.
 * This route exists separately because it is the only one that answers
 * "who added this, and when" — the closest thing the app has to a staff
 * action log — and because the admin screen must list the catalogue even
 * when it is empty, which a member-facing route has no reason to care about.
 *
 * Not paginated. The catalogue is a curated handful by construction; if it
 * ever grows past a screenful the right answer is a filter, not a page
 * counter that hides rows an operator is trying to audit.
 */
import { db, schema } from '@trackarr/db';
import { asc, desc, eq } from 'drizzle-orm';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const rows = await db
    .select({
      id: schema.presentationTemplates.id,
      name: schema.presentationTemplates.name,
      description: schema.presentationTemplates.description,
      category: schema.presentationTemplates.category,
      content: schema.presentationTemplates.content,
      createdAt: schema.presentationTemplates.createdAt,
      updatedAt: schema.presentationTemplates.updatedAt,
      createdById: schema.presentationTemplates.createdBy,
      createdByUsername: schema.users.username,
    })
    .from(schema.presentationTemplates)
    // LEFT: `created_by` is ON DELETE SET NULL, so a template added by an
    // admin whose account is gone still has to appear — losing the name must
    // not lose the row.
    .leftJoin(
      schema.users,
      eq(schema.presentationTemplates.createdBy, schema.users.id),
    )
    .where(eq(schema.presentationTemplates.visibility, 'site'))
    .orderBy(
      desc(schema.presentationTemplates.createdAt),
      asc(schema.presentationTemplates.id),
    );

  return {
    data: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      content: r.content,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      // null when the account is gone; the UI says "unknown" rather than
      // pretending nobody added it.
      createdBy: r.createdById === null
        ? null
        : { id: r.createdById, username: r.createdByUsername },
    })),
  };
});
