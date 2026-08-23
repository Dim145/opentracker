/**
 * POST /api/me/templates
 *
 * Create a presentation template owned by the caller. Always private: a
 * member cannot put a template in front of the whole site, and there is no
 * request field that would let them try. The catalogue everybody sees is
 * written only by /api/admin/templates.
 *
 * One rule is enforced here rather than in the UI: the per-user quota (admin
 * setting, default 5), counted over the caller's own rows.
 *
 * The template source is stored byte-for-byte. A template is
 * whitespace-sensitive — leading spaces, blank lines and the absence of
 * a trailing newline all change the listing it emits — so `content` is
 * deliberately the one field that is neither trimmed nor normalised.
 */
import { randomUUID } from 'node:crypto';
import { count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { assertTemplateGrammar } from '~~/utils/templateGrammar';
import { getTemplateQuotaPerUser } from '~~/utils/settings';
import { templateQuotaMessage } from '~~/utils/templatePolicy';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  category: z.enum(['universal', 'video']).default('universal'),
  // 15 000 chars: the renderer refuses to emit past 200 000, and the largest
  // thing a listing template has to hold is the built-in one plus commentary.
  // The size cap and the *grammar* are two different defences and both live on
  // this side — assertTemplateGrammar below runs the same parser the browser
  // renders with, so a template that stores cannot fail to render.
  content: z
    .string()
    .min(1)
    .max(15000)
    .refine((v) => v.trim().length > 0, {
      message: 'Template content cannot be blank',
    }),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await readValidatedBody(event, bodySchema.parse);
  assertTemplateGrammar(body.content);

  const quota = await getTemplateQuotaPerUser();
  const id = randomUUID();

  // Race-safe quota, by serialising creates per user rather than by
  // locking rows.
  //
  // `SELECT … FOR UPDATE` was the obvious reach and it does not hold:
  // under READ COMMITTED it locks the rows the scan SAW, and a row a
  // concurrent transaction inserts afterwards is a phantom the lock
  // cannot cover. Two POSTs racing at 4 of 5 both count 4 and both
  // insert. It also does nothing at all for a user with zero rows —
  // there is nothing there to lock.
  //
  // An advisory lock keyed on the owner has neither hole: it exists
  // whether or not the user owns anything, and it is held to the end of
  // the transaction, so the second create waits and then counts the
  // first one. Transaction-scoped (`_xact_`) so a crashed handler cannot
  // leave a user unable to create anything. The 7411 namespace only
  // separates this lock from any other advisory lock in the codebase —
  // the boot migrator holds one too.
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7411, hashtext(${user.id}))`);
    const [counted] = await tx
      .select({ n: count() })
      .from(schema.presentationTemplates)
      .where(eq(schema.presentationTemplates.ownerId, user.id));
    const owned = counted?.n ?? 0;
    if (owned >= quota) {
      return { ok: false as const };
    }
    // The first template a user creates becomes their default, so the
    // fiche picker has something selected without a second request.
    // Doing it only at zero rows is what keeps this endpoint out of the
    // "clear the previous default" business — that logic lives in
    // [id]/default.put.ts and exists exactly once.
    const isDefault = owned === 0;
    await tx.insert(schema.presentationTemplates).values({
      id,
      ownerId: user.id,
      name: body.name,
      // `||` not `??`: a description trimmed down to '' is an empty
      // field, and storing '' would make the listing render a blank line
      // where a missing description renders nothing.
      description: body.description || null,
      category: body.category,
      content: body.content,
      visibility: 'private',
      isDefault,
    });
    return { ok: true as const, isDefault };
  });

  if (!result.ok) {
    throw createError({
      statusCode: 400,
      message: templateQuotaMessage(quota),
    });
  }

  // `isDefault` comes back because the server may have set it without
  // being asked; the client would otherwise have to refetch to find out.
  return { id, isDefault: result.isDefault };
});
