/**
 * PUT /api/admin/themes/settings — the site default and `system` mode.
 *
 * Three slugs, and every one of them has to name something that exists and is
 * enabled. A default pointing at a disabled theme would leave every new member
 * and every anonymous visitor on the fallback, which looks like the setting not
 * working rather than like the theme being off.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { setSetting, SETTINGS_KEYS } from '~~/utils/settings';
import { BUILT_IN_THEMES, SYSTEM_THEME } from '@trackarr/shared';
import { themeSettingsSchema } from '~~/utils/themeSchemas';
import { bumpThemeVersion } from '~~/utils/themes';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await validateBody(event, themeSettingsSchema);

  const enabled = new Set(
    (
      await db
        .select({ slug: schema.themes.slug })
        .from(schema.themes)
        .where(eq(schema.themes.enabled, true))
    ).map((r) => r.slug),
  );
  const isBuiltIn = (v: string) =>
    (BUILT_IN_THEMES as readonly string[]).includes(v);

  /** A slug somebody may be sent to. `system` only makes sense as a default. */
  const check = (value: string | undefined, field: string, allowSystem: boolean) => {
    if (value === undefined) return;
    if (allowSystem && value === SYSTEM_THEME) return;
    if (isBuiltIn(value) || enabled.has(value)) return;
    throw createError({
      statusCode: 400,
      message: `${field}: no enabled theme called "${value}"`,
    });
  };

  check(body.themeDefault, 'themeDefault', true);
  // Not for the two halves of system mode: mapping `system` onto `system` is a
  // loop, and the schema's "must differ" rule would not catch it.
  check(body.systemLight, 'systemLight', false);
  check(body.systemDark, 'systemDark', false);

  if (body.themeDefault !== undefined) {
    await setSetting(SETTINGS_KEYS.THEME_DEFAULT, body.themeDefault);
  }
  if (body.systemLight !== undefined) {
    await setSetting(SETTINGS_KEYS.THEME_SYSTEM_LIGHT, body.systemLight);
  }
  if (body.systemDark !== undefined) {
    await setSetting(SETTINGS_KEYS.THEME_SYSTEM_DARK, body.systemDark);
  }

  await bumpThemeVersion();
  return { ok: true };
});
