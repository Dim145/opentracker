/**
 * PUT /api/admin/themes/:id/css — the owner's free-form CSS for one theme.
 *
 * A separate route from `PUT /api/admin/themes/:id` rather than another field on
 * it, and that separation is the point. The theme editor is open to every
 * administrator; this is not. Putting `customCss` on the shared route would mean
 * one handler with two permission levels inside it, and the failure mode of that
 * shape is a later refactor moving a field across the line without noticing.
 *
 * Three gates, each for a different reason:
 *
 * - **Owner**, because the token schema is bounded and this is not. Every
 *   administrator can pick colours; changing what selectors exist on the page is
 *   an instance-level decision.
 * - **Fresh auth**, because a stolen admin session should not be able to install
 *   persistent, JavaScript-free surveillance on every page for every member. It
 *   would survive a password change, which is exactly the property that makes it
 *   worth a re-authentication.
 * - **`sanitiseCustomCss`**, because the owner is not the only author. Themes
 *   import from JSON, so the CSS an owner saves may be CSS somebody else wrote.
 *
 * The stored value is the SANITISED output, not the submitted text. That is
 * deliberate: it means the stylesheet emitter never has to trust the column, and
 * a row edited by hand in the database still cannot smuggle anything past the
 * emitter — because what the emitter reads has already been through the parser.
 * The cost is that the owner's formatting and comments are not preserved, which
 * is a fair trade for the property.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireOwnerSession, requireFreshAuth } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { bumpThemeVersion } from '~~/utils/themes';
import { MAX_CUSTOM_CSS_BYTES, sanitiseCustomCss } from '~~/utils/themeCss';

const paramsSchema = z.object({ id: z.string().uuid() });

const bodySchema = z
  .object({
    // The cap is enforced again inside `sanitiseCustomCss`, on BYTES. This one
    // is on characters and exists only to stop a megabyte reaching the parser.
    css: z.string().max(MAX_CUSTOM_CSS_BYTES).default(''),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await requireOwnerSession(event);
  await requireFreshAuth(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const { id } = paramsSchema.parse(getRouterParams(event));
  const { css } = await validateBody(event, bodySchema);

  const [theme] = await db
    .select({ slug: schema.themes.slug })
    .from(schema.themes)
    .where(eq(schema.themes.id, id))
    .limit(1);
  if (!theme) {
    throw createError({ statusCode: 404, message: 'No such theme' });
  }

  const result = sanitiseCustomCss(css, theme.slug);
  if (!result.ok) {
    throw createError({
      statusCode: 400,
      message: 'This CSS was not accepted',
      // Every problem at once. The alternative is an owner fixing a twenty-rule
      // stylesheet one round trip at a time.
      data: { issues: result.issues },
    });
  }

  await db
    .update(schema.themes)
    .set({ customCss: result.css || null, updatedAt: new Date() })
    .where(eq(schema.themes.id, id));
  await bumpThemeVersion();

  return { ok: true, bytes: Buffer.byteLength(result.css, 'utf8') };
});
