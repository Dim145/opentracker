/**
 * GET /api/admin/themes — the editor's payload.
 *
 * Carries three things the admin console cannot derive on its own: the rows, the
 * two built-in token maps every theme inherits from, and the token schema. The
 * last two go over the wire rather than being imported by the front end so the
 * editor renders exactly the vocabulary this API will accept — one deploy, one
 * answer, no chance of a browser holding a stale idea of what a token is.
 *
 * The built-in maps are what make the "inherited vs overridden" display work:
 * the editor shows the base value as a field placeholder, so an admin sees what
 * they would get without the value being stored. A key absent from `tokens` is
 * an inheritance, and "reset" is a delete.
 */
import { asc } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { listFonts } from '~~/utils/fonts';
import { BUILT_IN_TOKENS, THEME_TOKENS } from '@trackarr/shared/theme';
import {
  MAX_ENABLED_THEMES,
  getDefaultTheme,
  getSystemMapping,
} from '~~/utils/themes';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const themes = await db
    .select()
    .from(schema.themes)
    .orderBy(asc(schema.themes.position), asc(schema.themes.createdAt));

  const [themeDefault, system] = await Promise.all([
    getDefaultTheme(),
    getSystemMapping(),
  ]);

  const roles = await db
    .select({ id: schema.roles.id, name: schema.roles.name })
    .from(schema.roles)
    .orderBy(asc(schema.roles.name));

  return {
    themes: themes.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      base: t.base,
      tokens: t.tokens,
      enabled: t.enabled,
      position: t.position,
      visibility: t.visibility,
      requiredRoles: t.requiredRoles,
      // Never the raw CSS. `GET /api/admin/themes/:id/css` is owner-gated and is
      // the only way to read it, so it cannot arrive here as a side effect of
      // listing themes for an administrator who may not see it.
      updatedAt: t.updatedAt,
    })),
    settings: {
      themeDefault,
      systemLight: system.light,
      systemDark: system.dark,
    },
    /** For the "N of 10 enabled" counter and the refusal past it. */
    maxEnabled: MAX_ENABLED_THEMES,
    enabledCount: themes.filter((t) => t.enabled).length,
    schema: THEME_TOKENS,
    builtIns: BUILT_IN_TOKENS,
    roles,
    // The owner's uploaded faces, so the font pickers can offer them alongside
    // the curated list. Listed for every administrator: only the owner may
    // upload one, but any administrator authoring a theme has to be able to
    // select one, and a picker that cannot list its options is not a picker.
    fonts: await listFonts(),
  };
});
