/**
 * PUT /api/me/templates/:id/default
 *
 * Make this template the caller's default pick, or clear the flag with
 * `{ "isDefault": false }`.
 *
 * The flag lives on the row, so only a template the caller owns can be
 * their default: to make a site template your default you duplicate it into
 * one of your own first. That is a deliberate consequence of the one-column
 * model, and the CHECK constraint spells it out — a site template has no
 * owner, so it cannot carry one member's preference. A per-user pointer table
 * would buy the ability to default straight to a site template without a copy;
 * it would also mean an admin editing that template silently changes what
 * every member's next upload looks like, which a copy makes explicit.
 *
 * Own endpoint rather than a PATCH field because setting a default is a
 * single-winner move: it has to clear the previous holder in the same
 * transaction the new one is set, or the partial unique index
 * `presentation_templates_default_unique` rejects the write.
 */
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  // Absent body means "make this the default" — the common case, and the
  // one a plain PUT with no payload should express.
  isDefault: z.boolean().default(true),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));
  // A PUT with no payload at all is the normal call, and readBody then
  // yields undefined (or throws on an empty-but-typed body) — neither of
  // which zod tolerates, hence the explicit fallback and safeParse.
  const raw = await readBody(event).catch(() => undefined);
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      message: 'isDefault must be a boolean',
    });
  }
  const body = parsed.data;

  // `updatedAt` is deliberately left alone by both statements below. It means
  // "when was this template last changed", and the list page renders it as
  // "Updated <date>" next to the character count — moving it because the
  // reader flipped which template is preselected told them the template had
  // been edited when nothing about it had.
  await db.transaction(async (tx) => {
    // Ownership is checked BEFORE anything is written, and the failure is
    // thrown from inside the transaction so it rolls back.
    //
    // The obvious shape — clear the old default, set the new one, then
    // 404 if nothing was set — commits the clear on the way out, because
    // returning a falsy value from the callback is a successful
    // transaction. A PUT naming a template that is not yours would wipe
    // the default you did have and then tell you the template was not
    // found. Reading first costs one indexed lookup and makes the whole
    // handler all-or-nothing.
    const target = await tx.query.presentationTemplates.findFirst({
      where: and(
        eq(schema.presentationTemplates.id, id),
        eq(schema.presentationTemplates.ownerId, user.id),
      ),
      columns: { id: true },
    });
    if (!target) {
      throw createError({ statusCode: 404, message: 'Template not found' });
    }

    // Clear first, set second. Postgres enforces a unique index at the
    // end of each statement, not at commit, so the reverse order would
    // fail against the previous default even though the transaction as a
    // whole leaves exactly one winner.
    if (body.isDefault) {
      await tx
        .update(schema.presentationTemplates)
        .set({ isDefault: false })
        .where(
          and(
            eq(schema.presentationTemplates.ownerId, user.id),
            eq(schema.presentationTemplates.isDefault, true),
            ne(schema.presentationTemplates.id, id),
          ),
        );
    }
    // The owner predicate stays on the write too: the read above proved
    // the row is the caller's, and repeating the predicate keeps that
    // true even if the two statements are ever reordered.
    await tx
      .update(schema.presentationTemplates)
      .set({ isDefault: body.isDefault })
      .where(
        and(
          eq(schema.presentationTemplates.id, id),
          eq(schema.presentationTemplates.ownerId, user.id),
        ),
      );
  });

  return { success: true, isDefault: body.isDefault };
});
