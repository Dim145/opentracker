/**
 * PATCH /api/me/templates/:id
 *
 * Owner-only edit. Publishing a template — and unpublishing one —
 * additionally requires staff, checked against the live role rather than
 * the sealed cookie.
 *
 * `isDefault` is deliberately NOT editable here: "which template is my
 * default" is a single-winner move that has to clear the previous holder
 * in the same transaction, and that transaction exists exactly once, in
 * [id]/default.put.ts.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { TemplateError, assertTemplateValid } from '@trackarr/shared/templateEngine';
import { readLiveRoles } from '~~/utils/adminAuth';
import {
  canWriteTemplate,
  resolveTemplateVisibility,
  type TemplateVisibility,
} from '~~/utils/templatePolicy';

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
    visibility: z.enum(['private', 'published']).optional(),
  })
  .refine(
    (b) =>
      b.name !== undefined ||
      b.description !== undefined ||
      b.category !== undefined ||
      b.content !== undefined ||
      b.visibility !== undefined,
    { message: 'At least one field must be provided' },
  );

/**
 * Reject a template whose grammar cannot be parsed, at the door.
 *
 * The cap on `content` was enforced server-side but the grammar was not, so an
 * unclosed `{{#SECTION}}` stored fine and only failed at render — and once a
 * staffer published it, it failed for every viewer instead of for its author.
 * The parser is the same one the browser renders with (it moved into
 * @trackarr/shared for exactly this), so a template that passes here cannot
 * throw there.
 *
 * Cheap by construction: parsing is linear and the body is capped at 15 kB.
 */
function assertGrammar(content: string): void {
  try {
    assertTemplateValid(content);
  } catch (err) {
    throw createError({
      statusCode: 400,
      message:
        err instanceof TemplateError
          ? `Template syntax error — ${err.message}`
          : 'Template syntax error',
    });
  }
}

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));
  const body = await readValidatedBody(event, bodySchema.parse);
  // Only when the field is actually being written — a rename must not be
  // refused because the stored body predates this check.
  if (body.content !== undefined) assertGrammar(body.content);

  const row = await db.query.presentationTemplates.findFirst({
    where: eq(schema.presentationTemplates.id, id),
  });
  if (!row) {
    throw createError({ statusCode: 404, message: 'Template not found' });
  }
  // The column is plain text (the schema has no enums), so normalise
  // before handing it to a decision that reasons over a union.
  const current: TemplateVisibility =
    row.visibility === 'published' ? 'published' : 'private';

  // The live-role read now also fires when the row is ALREADY published,
  // not only when `visibility` is the field being changed. Gating just the
  // transition let a demoted staffer keep rewriting the body of a template
  // the whole site renders: their request never touched `visibility`, so
  // the check never ran. Reading the role is one Redis-cached lookup, and
  // only for the rare published row.
  let isStaff = false;
  if (current === 'published' || (body.visibility !== undefined && body.visibility !== current)) {
    const live = await readLiveRoles(user.id);
    isStaff = !!live && (live.isAdmin || live.isModerator);
  }

  if (!canWriteTemplate(row, { id: user.id, isStaff })) {
    // 403 rather than 404 on a published row: its existence is already
    // public, so hiding it here would only confuse the author of a
    // legitimate request.
    throw createError({
      statusCode: 403,
      message:
        current === 'published'
          ? 'Only staff can edit a template published to the whole site'
          : 'You can only edit your own templates',
    });
  }
  const decision = resolveTemplateVisibility({
    requested: body.visibility,
    current,
    isStaff,
  });
  if (!decision.ok) {
    throw createError({ statusCode: 403, message: decision.message });
  }

  // The row id alone scopes the UPDATE: authorisation was settled above by
  // canWriteTemplate, and re-adding an owner predicate here would silently
  // turn a staff takedown into a 404. A DELETE landing between the read
  // and the write still matches zero rows and surfaces as a 404, which is
  // the case the predicate was there to catch.
  const [updated] = await db
    .update(schema.presentationTemplates)
    .set({
      name: body.name ?? row.name,
      // undefined = untouched, null or '' = cleared (an empty string
      // would otherwise render as a blank description line).
      description:
        body.description === undefined
          ? row.description
          : body.description || null,
      category: body.category ?? row.category,
      content: body.content ?? row.content,
      visibility: decision.visibility,
      updatedAt: new Date(),
    })
    .where(eq(schema.presentationTemplates.id, id))
    .returning({ id: schema.presentationTemplates.id });
  if (!updated) {
    throw createError({ statusCode: 404, message: 'Template not found' });
  }

  return { success: true };
});
