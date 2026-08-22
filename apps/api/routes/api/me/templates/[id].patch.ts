/**
 * PATCH /api/me/templates/:id
 *
 * Owner-only edit, and that is the whole rule now: a member's template is
 * private, a site template is not theirs to touch, and there is no field here
 * that could change which of the two a row is. Admins edit the site catalogue
 * through /api/admin/templates.
 *
 * `isDefault` is deliberately NOT editable here: "which template is my
 * default" is a single-winner move that has to clear the previous holder
 * in the same transaction, and that transaction exists exactly once, in
 * [id]/default.put.ts.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { assertTemplateGrammar } from '~~/utils/templateGrammar';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    // Explicit null clears the field; absent leaves it alone. The two
    // have to stay distinguishable or every rename would wipe the
    // description.
    description: z.string().trim().max(500).nullable().optional(),
    category: z.enum(['universal', 'video']).optional(),
    // Same cap and same reasoning as the create route — see index.post.ts.
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
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));
  const body = await readValidatedBody(event, bodySchema.parse);
  // Only when the field is actually being written — a rename must not be
  // refused because the stored body predates this check.
  if (body.content !== undefined) assertTemplateGrammar(body.content);

  // Scoped to the caller in the predicate, so a row that is not theirs is
  // indistinguishable from one that does not exist. This route used to read
  // the row first and answer 403 "you can only edit your own templates",
  // which confirmed the id of somebody else's private draft; the delete route
  // next door already answered 404 for the same case, and the two disagreeing
  // was the actual bug.
  const [updated] = await db
    .update(schema.presentationTemplates)
    .set({
      name: body.name,
      // undefined = untouched, null or '' = cleared (an empty string
      // would otherwise render as a blank description line).
      description:
        body.description === undefined ? undefined : body.description || null,
      category: body.category,
      content: body.content,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.presentationTemplates.id, id),
        eq(schema.presentationTemplates.ownerId, user.id),
      ),
    )
    .returning({ id: schema.presentationTemplates.id });

  if (!updated) {
    throw createError({ statusCode: 404, message: 'Template not found' });
  }

  return { success: true };
});
