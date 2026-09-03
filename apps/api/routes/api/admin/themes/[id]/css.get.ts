/**
 * GET /api/admin/themes/:id/css — read back what the owner saved.
 *
 * Owner-gated but NOT fresh-auth gated, and the asymmetry is intentional:
 * reading changes nothing, and requiring a re-authentication to look at a
 * stylesheet would train the owner to type their password on demand — which is
 * the habit the fresh-auth check on the write side exists to keep meaningful.
 *
 * `GET /api/admin/themes` deliberately omits this field for every caller, so
 * this is the only way to see it. That is why it exists at all: without it the
 * editor could only overwrite, never edit.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireOwnerSession } from '~~/utils/adminAuth';
import { MAX_CUSTOM_CSS_BYTES } from '~~/utils/themeCss';
import { validateRouterParams } from '~~/utils/schemas';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  await requireOwnerSession(event);
  const { id } = validateRouterParams(event, paramsSchema);

  const [theme] = await db
    .select({ css: schema.themes.customCss })
    .from(schema.themes)
    .where(eq(schema.themes.id, id))
    .limit(1);
  if (!theme) {
    throw createError({ statusCode: 404, message: 'No such theme' });
  }

  return { css: theme.css ?? '', maxBytes: MAX_CUSTOM_CSS_BYTES };
});
