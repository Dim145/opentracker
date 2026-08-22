/**
 * PATCH /api/admin/templates/:id
 *
 * Edit a site template in place. Any admin may edit any of them, not only the
 * one who added it: the catalogue is site content, and the point of curating
 * it centrally is that it does not become unmaintainable when one operator
 * stops being around.
 *
 * Members who duplicated it keep their copy untouched — a duplicate is a new
 * row, not a reference — and listings already posted carry rendered BBCode, so
 * editing here changes what future uploads start from and nothing else.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireAdminSession } from '~~/utils/adminAuth';
import { assertTemplateGrammar } from '~~/utils/templateGrammar';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    category: z.enum(['universal', 'video']).optional(),
    content: z
      .string()
      .min(1)
      .max(15000)
      .refine((v) => v.trim().length > 0, {
        message: 'Template content cannot be blank',
      })
      .optional(),
  })
  .refine(
    (b) =>
      b.name !== undefined ||
      b.description !== undefined ||
      b.category !== undefined ||
      b.content !== undefined,
    { message: 'At least one field must be provided' },
  );

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.admin);
  const { id } = paramsSchema.parse(getRouterParams(event));
  const body = await readValidatedBody(event, bodySchema.parse);
  if (body.content !== undefined) assertTemplateGrammar(body.content);

  // The `visibility = 'site'` predicate is authorisation, not a filter: it is
  // what stops this route from being a way for an admin to rewrite a member's
  // private draft. Admins moderate the catalogue, not people's drafts.
  const [updated] = await db
    .update(schema.presentationTemplates)
    .set({
      name: body.name,
      description:
        body.description === undefined ? undefined : body.description || null,
      category: body.category,
      content: body.content,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.presentationTemplates.id, id),
        eq(schema.presentationTemplates.visibility, 'site'),
      ),
    )
    .returning({ id: schema.presentationTemplates.id });

  if (!updated) {
    throw createError({ statusCode: 404, message: 'Site template not found' });
  }

  return { success: true };
});
