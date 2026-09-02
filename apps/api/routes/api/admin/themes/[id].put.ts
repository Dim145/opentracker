/**
 * PUT /api/admin/themes/:id
 *
 * `slug` is not editable — see the note on `createThemeSchema`. Neither is
 * `customCss`, and not because nothing writes it: `[id]/css.put.ts` does. It is
 * a separate route because it carries a different permission — owner rather than
 * admin — and re-authenticates. Keeping it out of THIS body is what stops an
 * administrator reaching it through the route they are allowed to call.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody, validateRouterParams } from '~~/utils/schemas';
import { uploadTokenProblems } from '~~/utils/fonts';
import { updateThemeSchema } from '~~/utils/themeSchemas';
import {
  bumpThemeVersion,
  releaseThemeReferences,
  withThemeCap,
} from '~~/utils/themes';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = validateRouterParams(event, paramsSchema);
  const body = await validateBody(event, updateThemeSchema);
  // A font role may name an uploaded face. The shared validator accepts the
  // SHAPE `upload:<uuid>`; only the database can say whether that face exists
  // and whether it was uploaded for this role.
  const fontProblems = await uploadTokenProblems(body.tokens);
  if (fontProblems.length) {
    throw createError({ statusCode: 400, message: fontProblems.join(' ') });
  }

  const [existing] = await db
    .select({ enabled: schema.themes.enabled, slug: schema.themes.slug })
    .from(schema.themes)
    .where(eq(schema.themes.id, id))
    .limit(1);
  if (!existing) {
    throw createError({ statusCode: 404, message: 'No such theme' });
  }

  // Only when it is being turned ON, and only counting the others: re-saving an
  // already-enabled theme must not fail because it counts itself. Counted inside
  // the transaction that writes, under an advisory lock — see `withThemeCap`.
  const turningOn = body.enabled === true && !existing.enabled;

  await withThemeCap(turningOn, id, (tx) =>
    tx
      .update(schema.themes)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined
          ? { description: body.description ?? null }
          : {}),
        ...(body.base !== undefined ? { base: body.base } : {}),
        // A whole map, not a merge. `tokens` holds divergences, so "remove this
        // override" has to be expressible — and a merge cannot express a deletion.
        // The editor sends the complete set of overrides it wants to keep, which
        // makes "reset to inherited" a delete rather than a write of a copied
        // default. That is exactly what stops a theme forking from its base.
        ...(body.tokens !== undefined
          ? { tokens: body.tokens as Record<string, string> }
          : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        visibility: body.visibility,
        requiredRoles:
          body.visibility === 'roles' ? (body.requiredRoles ?? null) : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.themes.id, id)),
  );

  // Turning a theme OFF removes it from the stylesheet, so anything still
  // pointing at it now points at a block that will not be emitted. The settings
  // route refuses to point at a disabled theme; this is the same invariant
  // approached from the other side, and without it an owner could disable the
  // site default and leave every anonymous visitor on a `data-theme` with no
  // matching rule.
  if (body.enabled === false && existing.enabled) {
    await releaseThemeReferences(existing.slug);
  }

  await bumpThemeVersion();
  return { ok: true };
});
