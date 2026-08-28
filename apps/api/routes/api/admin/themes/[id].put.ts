/**
 * PUT /api/admin/themes/:id
 *
 * `slug` is not editable — see the note on `createThemeSchema`. Neither is
 * `customCss`: the column exists from the first migration so wave 3 needs no
 * second one, but no route in wave 1 writes it. That is the gate, and it is a
 * stronger one than a permission check would be, because there is no codepath at
 * all rather than a codepath with a guard on it.
 */
import { and, count, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { updateThemeSchema } from '~~/utils/themeSchemas';
import { MAX_ENABLED_THEMES, bumpThemeVersion } from '~~/utils/themes';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));
  const body = await validateBody(event, updateThemeSchema);

  const [existing] = await db
    .select({ enabled: schema.themes.enabled })
    .from(schema.themes)
    .where(eq(schema.themes.id, id))
    .limit(1);
  if (!existing) {
    throw createError({ statusCode: 404, message: 'No such theme' });
  }

  // Only when it is being turned ON, and only counting the others: re-saving an
  // already-enabled theme must not fail because it counts itself.
  if (body.enabled === true && !existing.enabled) {
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.themes)
      .where(and(eq(schema.themes.enabled, true), ne(schema.themes.id, id)));
    if (Number(n) >= MAX_ENABLED_THEMES) {
      throw createError({
        statusCode: 400,
        message: `At most ${MAX_ENABLED_THEMES} themes can be enabled at once.`,
      });
    }
  }

  await db
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
        body.visibility === 'roles' ? (body.requiredRoles ?? []) : null,
      updatedAt: new Date(),
    })
    .where(eq(schema.themes.id, id));

  await bumpThemeVersion();
  return { ok: true };
});
