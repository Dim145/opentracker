/**
 * POST /api/admin/themes — create, duplicate, or import.
 *
 * One route for the three, because they differ only in where the starting tokens
 * come from: nothing (the base's values), another theme (`duplicateOf`), or the
 * request body (an exported JSON file). Splitting them would triple the slug and
 * cap logic for no gain.
 *
 * `duplicateOf` accepts `light` and `dark` as well as a slug, which is the point
 * of the feature: starting from a working appearance rather than a blank form is
 * how somebody produces a theme that is not unreadable.
 */
import { randomUUID } from 'node:crypto';
import { count, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { uploadTokenProblems } from '~~/utils/fonts';
import { BUILT_IN_THEMES } from '@trackarr/shared';
import { BUILT_IN_TOKENS } from '@trackarr/shared/theme';
import { createThemeSchema } from '~~/utils/themeSchemas';
import {
  MAX_ENABLED_THEMES,
  bumpThemeVersion,
  slugAvailable,
  slugify,
} from '~~/utils/themes';

export default defineEventHandler(async (event) => {
  const { user } = await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await validateBody(event, createThemeSchema);
  // A font role may name an uploaded face. The shared validator accepts the
  // SHAPE `upload:<uuid>`; only the database can say whether that face exists
  // and whether it was uploaded for this role.
  const fontProblems = await uploadTokenProblems(body.tokens);
  if (fontProblems.length) {
    throw createError({ statusCode: 400, message: fontProblems.join(' ') });
  }

  // The cap is on ENABLED themes, not on rows: every enabled one is emitted into
  // the stylesheet every visitor downloads, and that is the cost being bounded.
  // Keeping disabled drafts is free.
  const wantsEnabled = body.enabled ?? true;
  if (wantsEnabled) {
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(schema.themes)
      .where(eq(schema.themes.enabled, true));
    if (Number(n) >= MAX_ENABLED_THEMES) {
      throw createError({
        statusCode: 400,
        message: `At most ${MAX_ENABLED_THEMES} themes can be enabled at once. Disable one first, or create this as a draft.`,
      });
    }
  }

  const slug = body.slug ?? slugify(body.name);
  if (!(await slugAvailable(slug))) {
    throw createError({
      statusCode: 400,
      // Names the reserved case explicitly: "light" is a very natural thing for
      // an admin to type and a very confusing thing to be refused silently.
      message:
        'That name is already taken, unusable, or reserved (light, dark, system)',
    });
  }

  // Starting tokens. `duplicateOf` on a built-in copies the whole resolved map,
  // which is deliberate: the copy is then an independent theme rather than one
  // that silently tracks the built-in. Duplicating an admin theme copies only its
  // divergences, so it keeps inheriting from the base exactly as the original
  // does.
  let tokens: Record<string, string> = {};
  let base = body.base;
  if (body.duplicateOf) {
    if ((BUILT_IN_THEMES as readonly string[]).includes(body.duplicateOf)) {
      base = body.duplicateOf as (typeof BUILT_IN_THEMES)[number];
      tokens = { ...BUILT_IN_TOKENS[base] };
    } else {
      const [source] = await db
        .select({ base: schema.themes.base, tokens: schema.themes.tokens })
        .from(schema.themes)
        .where(eq(schema.themes.slug, body.duplicateOf))
        .limit(1);
      if (!source) {
        throw createError({ statusCode: 404, message: 'No theme to duplicate' });
      }
      base = source.base as (typeof BUILT_IN_THEMES)[number];
      tokens = { ...source.tokens };
    }
  }
  // An explicit token map wins over the duplicate source: that is what an import
  // is.
  if (body.tokens) tokens = { ...tokens, ...(body.tokens as Record<string, string>) };

  const id = randomUUID();
  await db.insert(schema.themes).values({
    id,
    slug,
    name: body.name,
    description: body.description ?? null,
    base,
    tokens,
    enabled: wantsEnabled,
    position: body.position ?? 0,
    visibility: body.visibility,
    requiredRoles: body.visibility === 'roles' ? (body.requiredRoles ?? []) : null,
    createdBy: user.id,
  });

  await bumpThemeVersion();
  return { ok: true, id, slug };
});
