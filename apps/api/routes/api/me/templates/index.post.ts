/**
 * POST /api/me/templates
 *
 * Create a presentation template owned by the caller.
 *
 * Two rules are enforced here rather than in the UI:
 *   - the per-user quota (admin setting, default 5), counted over the
 *     caller's own rows only
 *   - `visibility: 'published'` requires staff, re-read live from the DB
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
import { TemplateError, assertTemplateValid } from '@trackarr/shared/templateEngine';
import { readLiveRoles } from '~~/utils/adminAuth';
import { getTemplateQuotaPerUser } from '~~/utils/settings';
import {
  resolveTemplateVisibility,
  templateQuotaMessage,
} from '~~/utils/templatePolicy';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  category: z.enum(['universal', 'video']).default('universal'),
  // 15 000 chars: the client-side engine refuses to render past 200 000,
  // and the largest thing a listing template has to hold is the default
  // one plus commentary. Validation of the template *grammar* stays on
  // the client — the engine lives in apps/web/app/utils and Nitro cannot
  // import it — so this cap is the server's only structural defence.
  content: z
    .string()
    .min(1)
    .max(15000)
    .refine((v) => v.trim().length > 0, {
      message: 'Template content cannot be blank',
    }),
  visibility: z.enum(['private', 'published']).default('private'),
});

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
  const body = await readValidatedBody(event, bodySchema.parse);
  assertGrammar(body.content);

  // Publishing is visible to the whole site, so the flags are re-read
  // from the DB (≤60 s stale) instead of trusted from the sealed cookie:
  // a demoted staffer must not keep publishing off a week-old session.
  // The route itself stays user-level — hence readLiveRoles rather than
  // requireModeratorSession, which would lock non-staff out of creating
  // an ordinary private template.
  const live = await readLiveRoles(user.id);
  const isStaff = !!live && (live.isAdmin || live.isModerator);
  const decision = resolveTemplateVisibility({
    requested: body.visibility,
    current: 'private',
    isStaff,
  });
  if (!decision.ok) {
    throw createError({ statusCode: 403, message: decision.message });
  }

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
      visibility: decision.visibility,
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
